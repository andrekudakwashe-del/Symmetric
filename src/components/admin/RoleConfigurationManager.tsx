import React, { useState, useMemo } from 'react';
import { ActiveTab, Salesperson } from '../../types';
import {
  ALL_SYSTEM_MODULES,
  SystemModuleInfo,
  CoreFunctionCategory,
  RoleDefinition,
  DEFAULT_ROLE_DEFINITIONS,
  getStoredRoleDefinitions,
  saveRoleDefinition,
  deleteCustomRole,
  resetRolesToDefault,
  getModuleIcon,
} from '../../services/roleNavigationService';
import {
  Shield,
  Star,
  Plus,
  Trash2,
  RotateCcw,
  Check,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Smartphone,
  Eye,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Layers,
  Sliders,
  Menu,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface RoleConfigurationManagerProps {
  currentUser: Salesperson;
}

export const RoleConfigurationManager: React.FC<RoleConfigurationManagerProps> = ({
  currentUser,
}) => {
  const [roleDefs, setRoleDefs] = useState<Record<string, RoleDefinition>>(() =>
    getStoredRoleDefinitions()
  );
  const [selectedRoleId, setSelectedRoleId] = useState<string>('CASHIER');

  // Custom role creation state
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [cloneFromRoleId, setCloneFromRoleId] = useState('CASHIER');

  // Active role being edited
  const activeRole = useMemo(() => {
    return roleDefs[selectedRoleId] || roleDefs['CASHIER'] || DEFAULT_ROLE_DEFINITIONS.CASHIER;
  }, [roleDefs, selectedRoleId]);

  const [notification, setNotification] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  // Group all system modules by category
  const modulesByCategory = useMemo(() => {
    const map = new Map<CoreFunctionCategory, { label: string; modules: SystemModuleInfo[] }>();
    ALL_SYSTEM_MODULES.forEach((mod) => {
      if (!map.has(mod.category)) {
        map.set(mod.category, { label: mod.categoryLabel, modules: [] });
      }
      map.get(mod.category)!.modules.push(mod);
    });
    return Array.from(map.entries());
  }, []);

  // Update field of current role
  const updateActiveRole = (updates: Partial<RoleDefinition>) => {
    const updated: RoleDefinition = {
      ...activeRole,
      ...updates,
    };
    saveRoleDefinition(updated);
    setRoleDefs((prev) => ({
      ...prev,
      [activeRole.roleId]: updated,
    }));
  };

  // Toggle module allowed
  const handleToggleModuleAllowed = (moduleId: ActiveTab) => {
    let allowed = [...activeRole.allowedModules];
    let primary = [...activeRole.primaryModules];

    if (allowed.includes(moduleId)) {
      // Removing allowed module
      allowed = allowed.filter((id) => id !== moduleId);
      primary = primary.filter((id) => id !== moduleId);
      // If removed module was landing module, fallback to first primary
      let landing = activeRole.defaultLandingModule;
      if (landing === moduleId) {
        landing = primary[0] || allowed[0] || 'pos';
      }
      updateActiveRole({ allowedModules: allowed, primaryModules: primary, defaultLandingModule: landing });
    } else {
      // Adding allowed module
      allowed.push(moduleId);
      updateActiveRole({ allowedModules: allowed });
    }
  };

  // Toggle Category All
  const handleToggleCategoryAll = (modules: SystemModuleInfo[], enable: boolean) => {
    let allowed = new Set(activeRole.allowedModules);
    let primary = [...activeRole.primaryModules];

    modules.forEach((m) => {
      if (enable) {
        allowed.add(m.id);
      } else {
        allowed.delete(m.id);
        primary = primary.filter((id) => id !== m.id);
      }
    });

    let landing = activeRole.defaultLandingModule;
    if (!allowed.has(landing)) {
      landing = primary[0] || Array.from(allowed)[0] || 'pos';
    }

    updateActiveRole({
      allowedModules: Array.from(allowed),
      primaryModules: primary,
      defaultLandingModule: landing,
    });
  };

  // Primary Ranking: Move Up
  const handleMovePrimaryUp = (index: number) => {
    if (index <= 0) return;
    const arr = [...activeRole.primaryModules];
    const temp = arr[index - 1];
    arr[index - 1] = arr[index];
    arr[index] = temp;
    updateActiveRole({ primaryModules: arr });
  };

  // Primary Ranking: Move Down
  const handleMovePrimaryDown = (index: number) => {
    if (index >= activeRole.primaryModules.length - 1) return;
    const arr = [...activeRole.primaryModules];
    const temp = arr[index + 1];
    arr[index + 1] = arr[index];
    arr[index] = temp;
    updateActiveRole({ primaryModules: arr });
  };

  // Add module to primary rank list
  const handleAddModuleToPrimary = (moduleId: ActiveTab) => {
    if (activeRole.primaryModules.includes(moduleId)) return;
    const primary = [...activeRole.primaryModules, moduleId];
    // Also ensure it is in allowed
    const allowed = Array.from(new Set([...activeRole.allowedModules, moduleId]));
    updateActiveRole({ primaryModules: primary, allowedModules: allowed });
  };

  // Remove module from primary rank list
  const handleRemoveFromPrimary = (moduleId: ActiveTab) => {
    const primary = activeRole.primaryModules.filter((id) => id !== moduleId);
    updateActiveRole({ primaryModules: primary });
  };

  // Handle Create Custom Role
  const handleCreateRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newRoleName.trim();
    if (!name) {
      alert('Please enter a valid role name.');
      return;
    }
    const roleId = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    if (roleDefs[roleId]) {
      alert('A role with this identifier already exists.');
      return;
    }

    const template = roleDefs[cloneFromRoleId] || DEFAULT_ROLE_DEFINITIONS.CASHIER;
    const newDef: RoleDefinition = {
      roleId,
      roleName: name,
      description: newRoleDesc.trim() || `Custom role tailored for ${name}`,
      allowedModules: [...template.allowedModules],
      primaryModules: [...template.primaryModules],
      defaultLandingModule: template.defaultLandingModule,
      isSystem: false,
    };

    saveRoleDefinition(newDef);
    setRoleDefs((prev) => ({ ...prev, [roleId]: newDef }));
    setSelectedRoleId(roleId);
    setIsCreatingRole(false);
    setNewRoleName('');
    setNewRoleDesc('');
    try {
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
    } catch {}
    showNotification(`Custom role "${name}" created successfully!`);
  };

  // Handle Delete Role
  const handleDeleteRole = (roleId: string) => {
    if (DEFAULT_ROLE_DEFINITIONS[roleId]) {
      alert('Built-in system roles cannot be deleted.');
      return;
    }
    if (confirm(`Are you sure you want to permanently delete custom role "${roleDefs[roleId]?.roleName}"?`)) {
      deleteCustomRole(roleId);
      const nextDefs = { ...roleDefs };
      delete nextDefs[roleId];
      setRoleDefs(nextDefs);
      setSelectedRoleId('CASHIER');
      showNotification('Custom role deleted.');
    }
  };

  // Reset to Defaults
  const handleResetToDefaults = () => {
    if (confirm('Reset all roles and module rankings back to factory defaults?')) {
      resetRolesToDefault();
      setRoleDefs({ ...DEFAULT_ROLE_DEFINITIONS });
      setSelectedRoleId('CASHIER');
      showNotification('Roles reset to factory defaults.');
    }
  };

  // Helper to get module info
  const getModuleInfo = (id: ActiveTab): SystemModuleInfo => {
    return (
      ALL_SYSTEM_MODULES.find((m) => m.id === id) || {
        id,
        name: id,
        shortLabel: id,
        description: '',
        category: 'pos',
        categoryLabel: 'General',
        iconName: 'LayoutGrid',
      }
    );
  };

  return (
    <div id="role-configuration-manager" className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-20 right-4 z-50 bg-emerald-500 text-slate-950 font-bold px-4 py-2.5 rounded-2xl shadow-xl border border-emerald-400 flex items-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-5 h-5" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Banner / Explanation */}
      <div className="bg-gradient-to-r from-purple-900/40 via-indigo-950/40 to-slate-900/60 border border-purple-500/30 rounded-3xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/20 border border-amber-400/30 flex items-center justify-center text-amber-300 shadow shrink-0">
              <Star className="w-6 h-6 fill-amber-400" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                <span>Role Primary Functions &amp; Importance Ranking</span>
                <span className="text-[10px] bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full font-black uppercase">
                  Adaptive UI
                </span>
              </h2>
              <p className="text-xs text-slate-300">
                Define what modules each staff role can access, rank their primary functions in order of importance, and arrange the bottom navigation &amp; menu automatically.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              id="btn-reset-roles-default"
              onClick={handleResetToDefaults}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700 cursor-pointer"
              title="Reset all roles to factory presets"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Factory</span>
            </button>

            <button
              type="button"
              id="btn-add-custom-role"
              onClick={() => setIsCreatingRole(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-slate-950 font-black text-xs flex items-center space-x-1.5 shadow-md transition active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Custom Role</span>
            </button>
          </div>
        </div>
      </div>

      {/* Role Selector Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-2 custom-scrollbar">
        {Object.values(roleDefs).map((r) => {
          const isSelected = r.roleId === selectedRoleId;
          return (
            <button
              key={r.roleId}
              type="button"
              id={`tab-role-${r.roleId}`}
              onClick={() => setSelectedRoleId(r.roleId)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition flex items-center space-x-2 shrink-0 border cursor-pointer ${
                isSelected
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white border-transparent shadow-lg scale-105'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/80'
              }`}
            >
              <Shield className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-amber-400'}`} />
              <span>{r.roleName}</span>
              {!r.isSystem && (
                <span className="text-[9px] bg-purple-950 text-purple-300 px-1.5 py-0.2 rounded font-mono">
                  Custom
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Role Configuration Workstation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (8 cols): Primary Ranking + Access Checklist */}
        <div className="lg:col-span-8 space-y-6">
          {/* 1. Primary Functions Importance Ranker */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-400/20 text-amber-300 flex items-center justify-center font-bold">
                  ★
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">
                    Primary Functions (Ranked by Importance)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Highest ranked modules (#1 to #4) are placed directly in the bottom navigation bar and spotlighted in the menu.
                  </p>
                </div>
              </div>
              <span className="text-xs text-amber-300 font-mono font-bold bg-amber-950/80 border border-amber-800/80 px-2 py-0.5 rounded-full">
                {activeRole.primaryModules.length} Ranked
              </span>
            </div>

            {/* Reorderable Primary List */}
            <div className="space-y-2">
              {activeRole.primaryModules.map((modId, index) => {
                const info = getModuleInfo(modId);
                const Icon = getModuleIcon(info.iconName);
                const isFirst = index === 0;
                const isLast = index === activeRole.primaryModules.length - 1;
                const isLanding = activeRole.defaultLandingModule === modId;

                return (
                  <div
                    key={modId}
                    className={`flex items-center justify-between p-3 rounded-2xl border transition ${
                      isLanding
                        ? 'bg-purple-950/40 border-purple-500/50 shadow-sm'
                        : 'bg-slate-950/60 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center space-x-3 overflow-hidden">
                      {/* Priority Badge */}
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 text-slate-950 font-black text-xs flex items-center justify-center shadow shrink-0">
                        #{index + 1}
                      </div>

                      <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-amber-300 shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>

                      <div className="overflow-hidden">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-white truncate">
                            {info.name}
                          </h4>
                          {isLanding && (
                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              Default Landing
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">
                          {info.categoryLabel} • {info.description}
                        </p>
                      </div>
                    </div>

                    {/* Actions: Move Up / Down / Remove */}
                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMovePrimaryUp(index)}
                        disabled={isFirst}
                        className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 flex items-center justify-center transition"
                        title="Increase Priority (Move Up)"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMovePrimaryDown(index)}
                        disabled={isLast}
                        className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 flex items-center justify-center transition"
                        title="Decrease Priority (Move Down)"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveFromPrimary(modId)}
                        className="w-7 h-7 rounded-lg bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 flex items-center justify-center transition ml-1"
                        title="Remove from Primary"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {activeRole.primaryModules.length === 0 && (
                <div className="text-center py-6 text-slate-500 text-xs">
                  No primary functions selected. Add functions below to rank them for this role.
                </div>
              )}
            </div>

            {/* Quick Add Allowed Module to Primary */}
            <div className="pt-2">
              <label className="text-[11px] font-bold text-slate-300 block mb-1.5">
                + Add another allowed function to Primary Ranking:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {activeRole.allowedModules
                  .filter((id) => !activeRole.primaryModules.includes(id))
                  .map((id) => {
                    const info = getModuleInfo(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => handleAddModuleToPrimary(id)}
                        className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-purple-900/60 border border-slate-700 text-xs text-slate-300 hover:text-white flex items-center space-x-1.5 transition active:scale-95 cursor-pointer"
                      >
                        <Plus className="w-3 h-3 text-amber-400" />
                        <span>{info.shortLabel}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* 2. Module Access & Visibility Checklist */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center font-bold">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">
                    Module Access &amp; Visibility Checklist
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Enforce strict role isolation: users only see and navigate to modules enabled here.
                  </p>
                </div>
              </div>
              <span className="text-xs text-purple-300 font-mono font-bold bg-purple-950/80 border border-purple-800/80 px-2 py-0.5 rounded-full">
                {activeRole.allowedModules.length} Allowed
              </span>
            </div>

            <div className="space-y-4">
              {modulesByCategory.map(([catKey, { label, modules }]) => {
                const allAllowed = modules.every((m) => activeRole.allowedModules.includes(m.id));
                const someAllowed = modules.some((m) => activeRole.allowedModules.includes(m.id));

                return (
                  <div
                    key={catKey}
                    className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
                      <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>{label}</span>
                        <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.2 rounded font-mono">
                          {modules.filter((m) => activeRole.allowedModules.includes(m.id)).length}/
                          {modules.length}
                        </span>
                      </h4>

                      <div className="flex items-center space-x-2 text-[10px]">
                        <button
                          type="button"
                          onClick={() => handleToggleCategoryAll(modules, true)}
                          className="text-amber-400 hover:underline font-bold"
                        >
                          Enable All
                        </button>
                        <span className="text-slate-600">•</span>
                        <button
                          type="button"
                          onClick={() => handleToggleCategoryAll(modules, false)}
                          className="text-slate-400 hover:text-slate-200"
                        >
                          Disable All
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {modules.map((mod) => {
                        const isAllowed = activeRole.allowedModules.includes(mod.id);
                        const isPrimary = activeRole.primaryModules.includes(mod.id);
                        const Icon = getModuleIcon(mod.iconName);

                        return (
                          <div
                            key={mod.id}
                            onClick={() => handleToggleModuleAllowed(mod.id)}
                            className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer select-none transition ${
                              isAllowed
                                ? 'bg-slate-800/80 border-purple-500/40 text-white'
                                : 'bg-slate-900/40 border-slate-800/60 text-slate-500 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center space-x-2.5 overflow-hidden">
                              <div
                                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                  isAllowed
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-slate-800 text-slate-600'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                              </div>
                              <div className="overflow-hidden">
                                <p className={`text-xs font-bold truncate ${isAllowed ? 'text-white' : 'text-slate-400'}`}>
                                  {mod.name}
                                </p>
                                <p className="text-[10px] text-slate-500 truncate">
                                  {mod.shortLabel}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                              {isPrimary && (
                                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                              )}
                              <div
                                className={`w-5 h-5 rounded-md flex items-center justify-center border transition ${
                                  isAllowed
                                    ? 'bg-emerald-500 border-emerald-400 text-slate-950 font-black'
                                    : 'border-slate-700 bg-slate-800/50'
                                }`}
                              >
                                {isAllowed && <Check className="w-3 h-3 stroke-[3]" />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column (4 cols): Role Parameters & Live Device Preview */}
        <div className="lg:col-span-4 space-y-6">
          {/* Role Metadata Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-black text-white flex items-center justify-between pb-2 border-b border-slate-800">
              <span>Role Parameters</span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                {activeRole.roleId}
              </span>
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Role Title</label>
                <input
                  type="text"
                  value={activeRole.roleName}
                  onChange={(e) => updateActiveRole({ roleName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Description</label>
                <textarea
                  value={activeRole.description}
                  onChange={(e) => updateActiveRole({ description: e.target.value })}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
              </div>

              {/* Default Landing Module */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1 flex items-center justify-between">
                  <span>Default Landing Screen</span>
                  <span className="text-[10px] text-amber-400 font-normal">Opens upon login</span>
                </label>
                <select
                  value={activeRole.defaultLandingModule}
                  onChange={(e) => updateActiveRole({ defaultLandingModule: e.target.value as ActiveTab })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {activeRole.allowedModules.map((modId) => {
                    const info = getModuleInfo(modId);
                    return (
                      <option key={modId} value={modId}>
                        {info.name} ({info.shortLabel})
                      </option>
                    );
                  })}
                </select>
              </div>

              {!activeRole.isSystem && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteRole(activeRole.roleId)}
                    className="w-full py-2 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold flex items-center justify-center space-x-1.5 transition border border-rose-500/30 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Custom Role</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* LIVE DEVICE SIMULATOR PREVIEW */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-black text-white uppercase tracking-wider">
                Live Terminal Preview
              </h3>
            </div>
            <p className="text-[11px] text-slate-400">
              Preview of how the Bottom Navigation and Hamburger Menu will be arranged on terminal for{' '}
              <strong className="text-white">{activeRole.roleName}</strong>:
            </p>

            {/* Mock Bottom Navigation Bar */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2 shadow-inner">
              <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block mb-1 text-center">
                Bottom Navigation Bar (Top 4 Primary + Menu)
              </span>
              <div className="grid grid-cols-5 gap-1 text-center">
                {activeRole.primaryModules.slice(0, 4).map((modId, i) => {
                  const info = getModuleInfo(modId);
                  const Icon = getModuleIcon(info.iconName);
                  const isLanding = activeRole.defaultLandingModule === modId;
                  return (
                    <div
                      key={modId}
                      className={`p-1.5 rounded-xl border flex flex-col items-center justify-center ${
                        isLanding
                          ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white border-amber-400 shadow'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-[8px] font-bold mt-1 truncate max-w-full">
                        {info.shortLabel}
                      </span>
                    </div>
                  );
                })}

                {/* Fill remaining slots if fewer than 4 primary */}
                {Array.from({ length: Math.max(0, 4 - activeRole.primaryModules.length) }).map(
                  (_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="p-1.5 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-slate-600 flex flex-col items-center justify-center"
                    >
                      <span className="text-[8px]">Empty</span>
                    </div>
                  )
                )}

                {/* Menu Tab */}
                <div className="p-1.5 rounded-xl border border-amber-400/30 bg-slate-800/80 text-amber-300 flex flex-col items-center justify-center">
                  <Menu className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-bold mt-1">Menu</span>
                </div>
              </div>
            </div>

            {/* Mock Drawer Spotlight */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
              <span className="text-[9px] uppercase tracking-wider text-amber-400 font-bold block">
                Drawer Spotlight (Ranked Priority #1 - #{activeRole.primaryModules.length})
              </span>
              <div className="space-y-1">
                {activeRole.primaryModules.slice(0, 5).map((modId, i) => {
                  const info = getModuleInfo(modId);
                  return (
                    <div
                      key={modId}
                      className="flex items-center justify-between text-[10px] py-0.5 text-slate-300"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="w-3.5 h-3.5 rounded bg-amber-400 text-slate-950 font-black text-[8px] flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="font-semibold text-white">{info.name}</span>
                      </span>
                      <span className="text-slate-500 font-mono text-[9px]">{info.shortLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Create Custom Role */}
      {isCreatingRole && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-400/20 text-amber-300 flex items-center justify-center font-bold">
                <Plus className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">Create Custom Staff Role</h3>
                <p className="text-xs text-slate-400">
                  Add a brand new role with customized module ranking
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateRoleSubmit} className="space-y-3 pt-2">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  Role Title (e.g. Senior Cashier, Stock Controller)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Senior Cashier"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="Describe role responsibilities"
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">
                  Clone Initial Setup From:
                </label>
                <select
                  value={cloneFromRoleId}
                  onChange={(e) => setCloneFromRoleId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {Object.values(roleDefs).map((r) => (
                    <option key={r.roleId} value={r.roleId}>
                      {r.roleName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreatingRole(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-300 hover:to-orange-300 text-slate-950 text-xs font-black transition shadow-lg shadow-amber-950/40"
                >
                  Create &amp; Configure
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
