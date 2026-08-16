'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { STORE_MODULES, getModuleDef } from '@/lib/store-modules';

interface ModuleCard {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  enabled: boolean;
  category: string;
  adminPath?: string;
}

const colorMap: Record<string, string> = {
  red: 'bg-red-100 text-red-600',
  blue: 'bg-blue-100 text-blue-600',
  purple: 'bg-purple-100 text-purple-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  orange: 'bg-orange-100 text-orange-600',
  amber: 'bg-amber-100 text-amber-600',
  yellow: 'bg-yellow-100 text-yellow-600',
  indigo: 'bg-indigo-100 text-indigo-600',
  gray: 'bg-gray-100 text-gray-600',
};

export default function ModulesPage() {
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<ModuleCard[]>(
    STORE_MODULES.map((m) => ({ ...m, enabled: m.defaultEnabled ?? false }))
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  useEffect(() => {
    fetchModuleStates();
  }, []);

  const fetchModuleStates = async () => {
    try {
      const { data, error } = await supabase.from('store_modules').select('*');
      if (error) throw error;

      setModules(
        STORE_MODULES.map((def) => {
          const dbState = data?.find((d: { id: string; enabled?: boolean }) => d.id === def.id);
          return {
            ...def,
            enabled: dbState?.enabled ?? def.defaultEnabled ?? false,
          };
        })
      );
    } catch (err) {
      console.error('Error fetching modules:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleModule = async (id: string, currentState: boolean) => {
    const newState = !currentState;
    const def = getModuleDef(id);

    setModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: newState } : m))
    );

    try {
      const { error } = await supabase
        .from('store_modules')
        .upsert({ id, enabled: newState, updated_at: new Date().toISOString() });

      if (error) throw error;

      if (id === 'abandoned-cart') {
        await supabase.from('store_settings').upsert(
          {
            key: 'abandoned_cart_enabled',
            value: newState,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
      }

      window.location.reload();
    } catch (err) {
      console.error('Error updating module:', err);
      alert('Failed to update settings');
      setModules((prev) =>
        prev.map((m) => (m.id === id ? { ...m, enabled: currentState } : m))
      );
    }
  };

  const categories = ['all', ...Array.from(new Set(modules.map((m) => m.category)))];

  const [isLocked, setIsLocked] = useState(true);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === '6526') {
      setIsLocked(false);
    } else {
      setPinError('Incorrect PIN');
      setPin('');
    }
  };

  if (isLocked) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 text-center border border-gray-100">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="ri-lock-2-line text-4xl text-emerald-600"></i>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Restricted Access</h2>
          <p className="text-gray-500 mb-8">Please enter the security PIN to access Modules.</p>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <input
                type="password"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setPinError('');
                }}
                className="w-full text-center text-3xl font-bold tracking-widest px-4 py-4 border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all"
                placeholder="• • • •"
                maxLength={4}
                autoFocus
              />
            </div>
            {pinError && (
              <p className="text-red-500 text-sm font-medium animate-pulse">{pinError}</p>
            )}
            <button
              type="submit"
              className="w-full bg-gray-900 hover:bg-emerald-700 text-white font-bold py-4 rounded-xl transition-colors text-lg"
            >
              Unlock Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filteredModules = modules.filter((module) => {
    const matchesSearch =
      module.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      module.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'all' || module.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const groupedModules = filteredModules.reduce((acc, module) => {
    if (!acc[module.category]) acc[module.category] = [];
    acc[module.category].push(module);
    return acc;
  }, {} as Record<string, ModuleCard[]>);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Modules & Features</h1>
        <p className="text-gray-600 mb-8">Enable or disable features to customize your admin dashboard.</p>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
              <input
                type="text"
                placeholder="Search modules..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="p-2 border border-gray-300 rounded-lg outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">Loading modules...</div>
        ) : (
          <div className="space-y-10">
            {Object.entries(groupedModules).map(([category, items]) => (
              <div key={category}>
                <h2 className="text-xl font-bold text-gray-800 mb-4 border-l-4 border-emerald-500 pl-3">{category}</h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {items.map((module) => (
                    <div
                      key={module.id}
                      className={`bg-white rounded-xl border-2 p-6 transition-all ${module.enabled ? 'border-emerald-500 shadow-md' : 'border-gray-200 opacity-75'}`}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorMap[module.color] || 'bg-gray-100 text-gray-600'}`}>
                          <i className={`${module.icon} text-2xl`}></i>
                        </div>
                        <button
                          onClick={() => toggleModule(module.id, module.enabled)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${module.enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${module.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      <h3 className="text-lg font-bold text-gray-900">{module.name}</h3>
                      <p className="text-sm text-gray-500 mt-1 h-10">{module.description}</p>
                      <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${module.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                          {module.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        {module.adminPath && module.enabled && (
                          <Link
                            href={module.adminPath}
                            className="text-sm font-semibold text-emerald-700 hover:text-emerald-900"
                          >
                            Manage →
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
