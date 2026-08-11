// ============================================================================
// supabase-js compatibility layer over node-postgres.
//
// Goal: let the ~90 ported edge functions keep calling `supabase.from(...)...`
// unchanged while all data access runs against a plain Postgres database.
//
// Supported surface (exactly what the codebase uses — see migration recon):
//   .from(table)
//     .select(cols, { count, head })   -- incl. PostgREST embeds  fk:table(cols)
//     .insert(row|rows)                -- returning via .select().single()
//     .update(patch)
//     .upsert(row|rows, { onConflict })
//     .delete()
//     .eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in
//     .or('a.eq.x,b.ilike.%y%')
//     .not('col','in','(a,b)')  .not('col','is',null)
//     .filter(col, op, val)
//     .order(col, { ascending, nullsFirst })  .limit(n)  .range(a,b)
//     .single()  .maybeSingle()
//   await <builder>  ->  { data, error, count }
//
// Embeds are resolved with a second batched query per relationship (matching
// PostgREST's nested-object shape) using the app's FK map.
// ============================================================================

import { getPool } from "./pool";
import { FK_MAP, JSONB_COLUMNS, type FkEdge } from "./fk-map";
import { createStorageClient, type StorageClient } from "./storage";

type Row = Record<string, any>;
type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is" | "in";

interface Filter {
  kind: "cmp" | "in" | "is" | "or" | "notIn" | "notIs" | "raw";
  col?: string;
  op?: string;
  value?: any;
  values?: any[];
  orParts?: string;
  sql?: string;
  params?: any[];
}

interface OrderSpec {
  col: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

interface ParsedSelect {
  columns: string[]; // scalar columns from this table ('*' allowed)
  star: boolean;
  embeds: EmbedSpec[];
}

interface EmbedSpec {
  alias: string; // property name on the result object
  table: string; // related table
  fkColumn?: string; // fk column on the owning row (forward embeds)
  select: ParsedSelect;
}

const PG_IDENT = /^[a-z_][a-z0-9_]*$/i;

function ident(name: string): string {
  if (!PG_IDENT.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

// ---- select-string parser (handles nested embeds with parentheses) ---------
function parseSelect(sel: string): ParsedSelect {
  const result: ParsedSelect = { columns: [], star: false, embeds: [] };
  const tokens = splitTopLevel(sel);
  for (const tokenRaw of tokens) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const parenIdx = token.indexOf("(");
    if (parenIdx !== -1) {
      // Embed:  alias:table ( innerSelect )   OR   table ( innerSelect )
      const head = token.slice(0, parenIdx).trim();
      const inner = token.slice(parenIdx + 1, token.lastIndexOf(")"));
      let alias: string;
      let rhs: string;
      if (head.includes(":")) {
        const [a, t] = head.split(":");
        alias = a.trim();
        rhs = t.trim();
      } else {
        // bare form: `users(...)` or `users!constraint(...)` — key is the table name
        alias = head.split("!")[0].trim();
        rhs = head;
      }
      // Three supported PostgREST forms:
      //   alias:fk_column (cols)              e.g. groups:group_id(...)
      //   alias:table!fk_constraint (cols)    e.g. user:users!group_memberships_user_id_fkey(...)
      //   table (cols)                        e.g. group_memberships(...)  [reverse]
      if (rhs.includes("!")) {
        const [tableName, constraint] = rhs.split("!");
        // constraint name convention: <owning_table>_<fk_column>_fkey
        const fkColumn = constraint.replace(/_fkey$/, "").split("_").length
          ? deriveFkFromConstraint(constraint)
          : undefined;
        result.embeds.push({
          alias,
          table: tableName.trim(),
          fkColumn,
          select: parseSelect(inner),
        });
      } else {
        const resolved = resolveEmbed(alias, rhs);
        result.embeds.push({
          alias,
          table: resolved.table,
          fkColumn: resolved.fkColumn,
          select: parseSelect(inner),
        });
      }
    } else if (token === "*") {
      result.star = true;
    } else {
      result.columns.push(token);
    }
  }
  return result;
}

// alias/head can be:  "groups:group_id"  ->  alias=groups, joined via fk column group_id
//                     "users:user_id"    ->  alias=users, fk user_id
//                     "group:groups"     ->  alias=group, TABLE groups (fk resolved at query time)
//                     "groups"           ->  alias/table groups
// We store alias as the PROPERTY name the code reads.
const ALL_FK_COLUMNS = new Set(
  Object.values(FK_MAP)
    .flat()
    .map((e) => e.column)
);

function resolveEmbed(alias: string, secondPart: string): { table: string; fkColumn?: string } {
  if (secondPart && secondPart !== alias && ALL_FK_COLUMNS.has(secondPart)) {
    // fk-column form (e.g. groups:group_id, users:user_id, template:template_id)
    const fkColumn = secondPart;
    const edge = Object.values(FK_MAP)
      .flat()
      .find((e) => e.column === fkColumn);
    return { table: edge?.foreignTable ?? guessTableFromFk(fkColumn), fkColumn };
  }
  // table form (e.g. group:groups, or bare group_memberships). FK direction is
  // resolved at query time when the owning table is known.
  return { table: secondPart || alias };
}

// "<owning_table>_<fk_column>_fkey" -> fk_column. The owning-table prefix can
// itself contain underscores, so match against known FK columns from the map.
function deriveFkFromConstraint(constraint: string): string | undefined {
  const base = constraint.replace(/_fkey$/, "");
  const allFkCols = new Set(
    Object.values(FK_MAP)
      .flat()
      .map((e) => e.column)
  );
  // longest matching suffix wins (approved_by vs user_id etc.)
  let best: string | undefined;
  for (const col of allFkCols) {
    if (base.endsWith(`_${col}`) || base === col) {
      if (!best || col.length > best.length) best = col;
    }
  }
  return best;
}

function guessTableFromFk(fkColumn: string): string {
  // group_id -> groups, user_id -> users, membership_id -> group_memberships,
  // template_id -> (sms|email)_templates, schedule_id -> contribution_schedules
  const map: Record<string, string> = {
    group_id: "groups",
    user_id: "users",
    membership_id: "group_memberships",
    schedule_id: "contribution_schedules",
    contribution_schedule_id: "contribution_schedules",
    payment_transaction_id: "payment_transactions",
    payment_intent_id: "payment_intents",
    payout_schedule_id: "payout_schedules",
    wallet_id: "wallets",
    wallet_transaction_id: "wallet_transactions",
    ticket_id: "support_tickets",
  };
  if (map[fkColumn]) return map[fkColumn];
  if (fkColumn.endsWith("_id")) return fkColumn.slice(0, -3) + "s";
  return fkColumn;
}

// split by commas that are NOT inside parentheses
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---- the chainable query builder -------------------------------------------
class QueryBuilder implements PromiseLike<{ data: any; error: any; count: number | null }> {
  private table: string;
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectStr = "*";
  private wantCount = false;
  private headOnly = false;
  private filters: Filter[] = [];
  private orders: OrderSpec[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private payload: Row | Row[] | null = null;
  private onConflictCols: string[] | null = null;
  private returnRows = false;
  private singleMode: "none" | "single" | "maybe" = "none";

  constructor(table: string) {
    this.table = table;
  }

  select(sel = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.action === "select") {
      this.selectStr = sel || "*";
    } else {
      // insert/update/upsert followed by .select() => RETURNING
      this.returnRows = true;
      this.selectStr = sel || "*";
    }
    if (opts?.count) this.wantCount = true;
    if (opts?.head) {
      this.headOnly = true;
      this.wantCount = true;
    }
    return this;
  }

  insert(payload: Row | Row[]) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }
  update(patch: Row) {
    this.action = "update";
    this.payload = patch;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
    this.action = "upsert";
    this.payload = payload;
    this.onConflictCols = opts?.onConflict
      ? opts.onConflict.split(",").map((c) => c.trim())
      : null;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }

  eq(col: string, value: any) { return this.cmp(col, "eq", value); }
  neq(col: string, value: any) { return this.cmp(col, "neq", value); }
  gt(col: string, value: any) { return this.cmp(col, "gt", value); }
  gte(col: string, value: any) { return this.cmp(col, "gte", value); }
  lt(col: string, value: any) { return this.cmp(col, "lt", value); }
  lte(col: string, value: any) { return this.cmp(col, "lte", value); }
  like(col: string, value: any) { return this.cmp(col, "like", value); }
  ilike(col: string, value: any) { return this.cmp(col, "ilike", value); }

  is(col: string, value: any) {
    this.filters.push({ kind: "is", col, value });
    return this;
  }
  in(col: string, values: any[]) {
    this.filters.push({ kind: "in", col, values });
    return this;
  }
  or(parts: string) {
    this.filters.push({ kind: "or", orParts: parts });
    return this;
  }
  not(col: string, op: string, value: any) {
    if (op === "in") this.filters.push({ kind: "notIn", col, value });
    else if (op === "is") this.filters.push({ kind: "notIs", col, value });
    else this.filters.push({ kind: "cmp", col, op: `not_${op}`, value });
    return this;
  }
  filter(col: string, op: string, value: any) {
    // PostgREST-style textual op. Handle the ones the code uses.
    if (op === "in") {
      // value like "(a,b,c)"
      const vals = String(value).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim());
      this.filters.push({ kind: "in", col, values: vals });
    } else if (op === "is") {
      this.filters.push({ kind: "is", col, value: value === "null" ? null : value });
    } else {
      this.filters.push({ kind: "cmp", col, op, value });
    }
    return this;
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({
      col,
      ascending: opts?.ascending !== false,
      nullsFirst: opts?.nullsFirst,
    });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single() {
    this.singleMode = "single";
    this.returnRows = true;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    this.returnRows = true;
    return this;
  }

  private cmp(col: string, op: Op, value: any) {
    this.filters.push({ kind: "cmp", col, op, value });
    return this;
  }

  // ---- WHERE construction ---------------------------------------------------
  private buildWhere(params: any[]): string {
    const clauses: string[] = [];
    for (const f of this.filters) {
      if (f.kind === "cmp") {
        clauses.push(this.cmpClause(f.col!, f.op!, f.value, params));
      } else if (f.kind === "in") {
        if (!f.values || f.values.length === 0) {
          clauses.push("false");
        } else {
          const ph = f.values.map((v) => {
            params.push(v);
            return `$${params.length}`;
          });
          clauses.push(`${ident(f.col!)} IN (${ph.join(",")})`);
        }
      } else if (f.kind === "notIn") {
        const raw = String(f.value).replace(/^\(|\)$/g, "").trim();
        if (!raw) { clauses.push("true"); continue; }
        const vals = raw.split(",").map((s) => s.trim());
        const ph = vals.map((v) => {
          params.push(v);
          return `$${params.length}`;
        });
        clauses.push(`(${ident(f.col!)} IS NULL OR ${ident(f.col!)} NOT IN (${ph.join(",")}))`);
      } else if (f.kind === "is") {
        clauses.push(this.isClause(f.col!, f.value));
      } else if (f.kind === "notIs") {
        const inner = this.isClause(f.col!, f.value);
        clauses.push(`NOT (${inner})`);
      } else if (f.kind === "or") {
        clauses.push(this.orClause(f.orParts!, params));
      }
    }
    return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  }

  private isClause(col: string, value: any): string {
    if (value === null || value === "null") return `${ident(col)} IS NULL`;
    if (value === true || value === "true") return `${ident(col)} IS TRUE`;
    if (value === false || value === "false") return `${ident(col)} IS FALSE`;
    return `${ident(col)} IS NOT DISTINCT FROM ${value}`;
  }

  private cmpClause(col: string, op: string, value: any, params: any[]): string {
    const negate = op.startsWith("not_");
    const bare = negate ? op.slice(4) : op;
    const sqlOp: Record<string, string> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
      like: "LIKE",
      ilike: "ILIKE",
    };
    const o = sqlOp[bare];
    if (!o) throw new Error(`Unsupported operator: ${op}`);
    params.push(value);
    const clause = `${ident(col)} ${o} $${params.length}`;
    return negate ? `NOT (${clause})` : clause;
  }

  // parse "col.op.val,col2.op2.val2" (PostgREST or-filter). Supports
  // eq/ilike/like/gt/lt/gte/lte/is/neq, `in.(a,b,c)` lists, and nested
  // `and(...)` / `or(...)` groups, e.g.
  //   status.in.(approved,active),and(status.eq.pending,paid.gt.0)
  private orClause(parts: string, params: any[]): string {
    const segs = splitTopLevel(parts); // commas at top level separate OR terms
    const ors = segs.map((seg) => this.orTerm(seg.trim(), params));
    return `(${ors.join(" OR ")})`;
  }

  private orTerm(seg: string, params: any[]): string {
    // Nested logical group: and(...) / or(...)
    const grp = /^(and|or)\(([\s\S]*)\)$/.exec(seg);
    if (grp) {
      const joiner = grp[1] === "and" ? " AND " : " OR ";
      const inner = splitTopLevel(grp[2]).map((s) => this.orTerm(s.trim(), params));
      return `(${inner.join(joiner)})`;
    }

    const first = seg.indexOf(".");
    const col = seg.slice(0, first).trim();
    const rest = seg.slice(first + 1).trim();

    // in.(a,b,c) list membership
    if (rest.startsWith("in.(") && rest.endsWith(")")) {
      const vals = rest
        .slice(4, -1)
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      if (!vals.length) return "FALSE";
      const placeholders = vals.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${ident(col)} IN (${placeholders.join(", ")})`;
    }

    const second = rest.indexOf(".");
    const op = rest.slice(0, second).trim();
    const val = rest.slice(second + 1).trim();
    if (op === "is") {
      return this.isClause(col, val);
    }
    const sqlOp: Record<string, string> = {
      eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE",
    };
    const o = sqlOp[op];
    if (!o) throw new Error(`Unsupported or() operator: ${op}`);
    params.push(val);
    return `${ident(col)} ${o} $${params.length}`;
  }

  private buildOrderLimit(): string {
    let sql = "";
    if (this.orders.length) {
      const parts = this.orders.map((o) => {
        const dir = o.ascending ? "ASC" : "DESC";
        const nulls =
          o.nullsFirst === undefined
            ? o.ascending
              ? "NULLS LAST"
              : "NULLS FIRST"
            : o.nullsFirst
            ? "NULLS FIRST"
            : "NULLS LAST";
        return `${ident(o.col)} ${dir} ${nulls}`;
      });
      sql += ` ORDER BY ${parts.join(", ")}`;
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      const limit = this.rangeTo - this.rangeFrom + 1;
      sql += ` LIMIT ${limit} OFFSET ${this.rangeFrom}`;
    } else if (this.limitN !== null) {
      sql += ` LIMIT ${this.limitN}`;
    }
    return sql;
  }

  // ---- execution ------------------------------------------------------------
  async exec(): Promise<{ data: any; error: any; count: number | null }> {
    try {
      const pool = getPool();
      let rows: Row[] = [];
      let count: number | null = null;

      if (this.action === "select") {
        const params: any[] = [];
        const where = this.buildWhere(params);
        if (this.wantCount) {
          const cRes = await pool.query(
            `SELECT count(*)::int AS c FROM ${ident(this.table)} ${where}`,
            params
          );
          count = cRes.rows[0]?.c ?? 0;
        }
        if (!this.headOnly) {
          const parsed = parseSelect(this.selectStr);
          const cols = this.topLevelColumns(parsed);
          const orderLimit = this.buildOrderLimit();
          const res = await pool.query(
            `SELECT ${cols} FROM ${ident(this.table)} ${where}${orderLimit}`,
            params
          );
          rows = res.rows;
          await this.resolveEmbeds(rows, parsed);
        }
      } else if (this.action === "insert" || this.action === "upsert") {
        rows = await this.execInsert(pool);
      } else if (this.action === "update") {
        rows = await this.execUpdate(pool);
      } else if (this.action === "delete") {
        rows = await this.execDelete(pool);
      }

      // shape single/maybe
      if (this.singleMode === "single") {
        if (rows.length !== 1) {
          return {
            data: null,
            error: {
              message:
                rows.length === 0
                  ? "JSON object requested, multiple (or no) rows returned"
                  : "Results contain more than one row",
              code: rows.length === 0 ? "PGRST116" : "PGRST114",
            },
            count,
          };
        }
        return { data: rows[0], error: null, count };
      }
      if (this.singleMode === "maybe") {
        // PostgREST semantics: >1 row is an error even for maybeSingle().
        if (rows.length > 1) {
          return {
            data: null,
            error: { message: "Results contain more than one row", code: "PGRST116" },
            count,
          };
        }
        return { data: rows[0] ?? null, error: null, count };
      }
      return { data: this.headOnly ? null : rows, error: null, count };
    } catch (err: any) {
      return { data: null, error: { message: err.message, code: err.code }, count: null };
    }
  }

  private topLevelColumns(parsed: ParsedSelect): string {
    if (parsed.star && parsed.columns.length === 0) return "*";
    const cols = new Set<string>();
    if (parsed.star) cols.add("*");
    for (const c of parsed.columns) cols.add(ident(c));
    // ensure fk columns needed for embeds are fetched
    let hasReverse = false;
    for (const e of parsed.embeds) {
      let fk = e.fkColumn;
      if (!fk) {
        const fwd = (FK_MAP[this.table] || []).find((x) => x.foreignTable === e.table);
        if (fwd) fk = fwd.column;
        else hasReverse = true;
      }
      if (fk) cols.add(ident(fk));
    }
    // reverse embeds join on this table's id — only fetch it when needed
    // (some tables, e.g. settings, have no id column)
    if (!parsed.star && hasReverse) {
      cols.add(ident("id"));
    }
    return Array.from(cols).join(", ");
  }

  private async resolveEmbeds(rows: Row[], parsed: ParsedSelect): Promise<void> {
    if (rows.length === 0 || parsed.embeds.length === 0) return;
    const pool = getPool();
    for (const embed of parsed.embeds) {
      // If no explicit FK column, decide direction from the FK map: an edge
      // from THIS table to the embed table means forward (object); otherwise
      // it's a reverse has-many (array).
      let fk = embed.fkColumn;
      let embedTable = embed.table;
      if (fk) {
        // fk-column form: prefer the owning table's own FK edge to disambiguate
        // (template_id -> sms_templates vs email_templates depends on the table)
        const own = (FK_MAP[this.table] || []).find((e) => e.column === fk);
        if (own) embedTable = own.foreignTable;
      } else {
        const fwd = (FK_MAP[this.table] || []).find((e) => e.foreignTable === embed.table);
        if (fwd) fk = fwd.column;
      }
      if (fk) {
        // forward embed: current.fk -> related.id  (object)
        const ids = Array.from(
          new Set(rows.map((r) => r[fk]).filter((v) => v !== null && v !== undefined))
        );
        const wantId = embedWantsId(embed.select);
        const innerCols = this.embedColumns(embed.select);
        let related: Row[] = [];
        if (ids.length) {
          const ph = ids.map((_, i) => `$${i + 1}`).join(",");
          const res = await pool.query(
            `SELECT ${innerCols} FROM ${ident(embedTable)} WHERE ${ident("id")} IN (${ph})`,
            ids
          );
          related = res.rows;
        }
        const byId = new Map(related.map((r) => [r.id, r]));
        // resolve nested embeds
        await this.resolveEmbeds(related, embed.select);
        // PostgREST only returns requested columns — drop the join-only id
        if (!wantId) for (const r of related) delete r.id;
        for (const r of rows) {
          r[embed.alias] = byId.get(r[fk]) ?? null;
        }
      } else {
        // reverse embed (has-many): related.<table>_fk -> current.id (array)
        const edge = this.findReverseEdge(embedTable);
        const fkCol = edge?.column ?? `${singularize(this.table)}_id`;
        const parentIds = Array.from(new Set(rows.map((r) => r.id).filter(Boolean)));
        const wantId = embedWantsId(embed.select);
        const wantFk = embed.select.star || embed.select.columns.includes(fkCol);
        const innerCols = this.embedColumns(embed.select, fkCol);
        let related: Row[] = [];
        if (parentIds.length) {
          const ph = parentIds.map((_, i) => `$${i + 1}`).join(",");
          const res = await pool.query(
            `SELECT ${innerCols} FROM ${ident(embedTable)} WHERE ${ident(fkCol)} IN (${ph})`,
            parentIds
          );
          related = res.rows;
        }
        await this.resolveEmbeds(related, embed.select);
        const grouped = new Map<any, Row[]>();
        for (const r of related) {
          const k = r[fkCol];
          if (!grouped.has(k)) grouped.set(k, []);
          if (!wantFk) delete r[fkCol];
          if (!wantId) delete r.id;
          grouped.get(k)!.push(r);
        }
        for (const r of rows) r[embed.alias] = grouped.get(r.id) ?? [];
      }
    }
  }

  private embedColumns(parsed: ParsedSelect, extraFk?: string): string {
    if (parsed.star && parsed.columns.length === 0) return "*";
    const cols = new Set<string>();
    if (parsed.star) cols.add("*");
    for (const c of parsed.columns) cols.add(ident(c));
    cols.add(ident("id"));
    if (extraFk) cols.add(ident(extraFk));
    for (const e of parsed.embeds) if (e.fkColumn) cols.add(ident(e.fkColumn));
    return Array.from(cols).join(", ");
  }

  private findReverseEdge(relatedTable: string): FkEdge | undefined {
    return (FK_MAP[relatedTable] || []).find((e) => e.foreignTable === this.table);
  }

  private async execInsert(pool: ReturnType<typeof getPool>): Promise<Row[]> {
    const rowsIn = Array.isArray(this.payload) ? this.payload : [this.payload!];
    if (rowsIn.length === 0) return [];

    // Mixed upsert batches (some rows with id, some without) used to coalesce
    // columns across the whole payload, then send id=NULL for new rows — which
    // fails the NOT NULL primary key and aborts the entire batch. That is why
    // admins could not add sizes 36/42 to products that already had variants.
    if (this.action === "upsert") {
      const withId = rowsIn.filter((r) => r.id != null && r.id !== "");
      const withoutId = rowsIn.filter((r) => r.id == null || r.id === "");
      const out: Row[] = [];
      if (withId.length > 0) {
        out.push(...(await this.execInsertRows(pool, withId, true)));
      }
      if (withoutId.length > 0) {
        out.push(...(await this.execInsertRows(pool, withoutId, false)));
      }
      return out;
    }

    return this.execInsertRows(pool, rowsIn, false);
  }

  private async execInsertRows(
    pool: ReturnType<typeof getPool>,
    rowsIn: Row[],
    asUpsert: boolean
  ): Promise<Row[]> {
    if (rowsIn.length === 0) return [];
    // Only include keys that are actually present (skip undefined).
    const cols = Array.from(
      rowsIn.reduce<Set<string>>((set, r) => {
        Object.keys(r).forEach((k) => {
          if (r[k] !== undefined) set.add(k);
        });
        return set;
      }, new Set())
    );

    // Plain insert: omit id so Postgres default uuid_generate_v4() runs,
    // unless every row already supplies an id.
    const allHaveId = rowsIn.every((r) => r.id != null && r.id !== "");
    const insertCols = !asUpsert && !allHaveId ? cols.filter((c) => c !== "id") : cols;

    if (insertCols.length === 0) return [];

    const params: any[] = [];
    const valuesSql = rowsIn
      .map((r) => {
        const ph = insertCols.map((c) => {
          params.push(normalizeValue(r[c], this.table, c));
          return `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      })
      .join(", ");
    const colSql = insertCols.map(ident).join(", ");
    let sql = `INSERT INTO ${ident(this.table)} (${colSql}) VALUES ${valuesSql}`;
    if (asUpsert) {
      const conflict = this.onConflictCols?.length
        ? this.onConflictCols.map(ident).join(", ")
        : "id";
      const conflictCols = this.onConflictCols || ["id"];
      const updates = insertCols
        .filter((c) => !conflictCols.includes(c))
        .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
      sql += ` ON CONFLICT (${conflict}) DO ${
        updates.length ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"
      }`;
    }
    if (this.returnRows) sql += " RETURNING *";
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private async execUpdate(pool: ReturnType<typeof getPool>): Promise<Row[]> {
    const patch = this.payload as Row;
    const params: any[] = [];
    const sets = Object.keys(patch).map((c) => {
      params.push(normalizeValue(patch[c], this.table, c));
      return `${ident(c)} = $${params.length}`;
    });
    const where = this.buildWhere(params);
    let sql = `UPDATE ${ident(this.table)} SET ${sets.join(", ")} ${where}`;
    if (this.returnRows) sql += " RETURNING *";
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private async execDelete(pool: ReturnType<typeof getPool>): Promise<Row[]> {
    const params: any[] = [];
    const where = this.buildWhere(params);
    let sql = `DELETE FROM ${ident(this.table)} ${where}`;
    if (this.returnRows) sql += " RETURNING *";
    const res = await pool.query(sql, params);
    return res.rows;
  }

  // PromiseLike: allow `await builder`
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

function embedWantsId(parsed: ParsedSelect): boolean {
  return parsed.star || parsed.columns.includes("id");
}

function singularize(table: string): string {
  if (table.endsWith("ies")) return table.slice(0, -3) + "y";
  if (table.endsWith("s")) return table.slice(0, -1);
  return table;
}

// jsonb columns must be passed to pg as JSON text (PostgREST serializes ANY
// JS value — object, array, string, number, bool — as JSON for jsonb columns).
// Native arrays pass through only for genuine Postgres array columns
// (e.g. manual_payments.membership_ids).
function normalizeValue(v: any, table?: string, column?: string): any {
  if (v === undefined || v === null) return null;
  const isJsonbCol = !!(table && column && JSONB_COLUMNS[table]?.has(column));
  if (isJsonbCol) return JSON.stringify(v);
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  return v;
}

export interface SupabaseCompatClient {
  from(table: string): QueryBuilder;
  storage: StorageClient;
  rpc(fn: string, args?: Record<string, any>): Promise<{ data: any; error: any }>;
}

export function createClient(_url?: string, _key?: string): SupabaseCompatClient {
  return {
    from(table: string) {
      if (!PG_IDENT.test(table)) throw new Error(`Unsafe table name: ${table}`);
      return new QueryBuilder(table);
    },
    storage: createStorageClient(),
    // Calls a public.* SQL function with named arguments, mirroring
    // PostgREST's /rpc/<fn> behaviour for scalar-returning functions
    // (all server-side RPCs here return jsonb or boolean scalars).
    async rpc(fn: string, args?: Record<string, any>) {
      try {
        if (!PG_IDENT.test(fn)) throw new Error(`Unsafe function name: ${fn}`);
        const entries = Object.entries(args || {});
        for (const [name] of entries) {
          if (!PG_IDENT.test(name)) throw new Error(`Unsafe argument name: ${name}`);
        }
        const params = entries.map(([, v]) =>
          v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v
        );
        const argSql = entries.map(([name], i) => `${ident(name)} => $${i + 1}`).join(", ");
        const sql = `SELECT public.${ident(fn)}(${argSql}) AS result`;
        const { rows } = await getPool().query(sql, params);
        return { data: rows[0]?.result ?? null, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e?.message || String(e) } };
      }
    },
  };
}
