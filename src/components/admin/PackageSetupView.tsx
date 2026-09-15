import React, { useState, useEffect, useMemo } from 'react';
import {
  Package,
  Plus,
  Edit2,
  Check,
  X,
  Search,
  CheckCircle2,
  Shield,
  Layers,
  Sliders,
  DollarSign,
  Building2,
  Users,
  Sparkles,
  RotateCcw,
  Trash2,
  Copy,
  Info,
  ChevronRight,
  Filter,
  ArrowRight,
  Zap,
  Lock,
  Save,
} from 'lucide-react';
import {
  SaaSPackage,
  AppFunctionDefinition,
  AppFunctionCategory,
  ALL_APP_FUNCTIONS,
  getPackages,
  savePackages,
  createPackage,
  updatePackage,
  deletePackage,
  resetPackagesToDefaults,
  assignCompanyPackage,
} from '../../services/packageService';
import { getCompanies, saveCompany } from '../../db/roomDatabase';
import { Company } from '../../data/saasData';
import confetti from 'canvas-confetti';

interface PackageSetupViewProps {
  onClose?: () => void;
  onOpenReportBuilder?: () => void;
  onOpenSheetSetup?: () => void;
}

export const PackageSetupView: React.FC<PackageSetupViewProps> = ({
  onClose,
  onOpenReportBuilder,
  onOpenSheetSetup,
}) => {
  const [packages, setPackages] = useState<SaaSPackage[]>(() => getPackages());
  const [companies, setCompanies] = useState<Company[]>(() => getCompanies());
  const [selectedPackage, setSelectedPackage] = useState<SaaSPackage | null>(() => {
    const pkgs = getPackages();
    return pkgs[0] || null;
  });

  const [isEditing, setIsEditing] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Form State for Package
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editTier, setEditTier] = useState<'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM'>('CUSTOM');
  const [editDesc, setEditDesc] = useState('');
  const [editPriceMonthly, setEditPriceMonthly] = useState<number>(25);
  const [editPriceAnnual, setEditPriceAnnual] = useState<number>(250);
  const [editMaxBranches, setEditMaxBranches] = useState<number>(1);
  const [editMaxStaff, setEditMaxStaff] = useState<number>(3);
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [editFeatures, setEditFeatures] = useState<Record<string, boolean>>({});

  // Search and Category Filter for Features Matrix
  const [featureSearch, setFeatureSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<AppFunctionCategory | 'ALL'>('ALL');
  const [activeTab, setActiveTab] = useState<'PACKAGES' | 'TENANT_ASSIGNMENTS'>('PACKAGES');

  // Staged Tenant Package Assignments & Save States
  const [stagedTenantPackages, setStagedTenantPackages] = useState<Record<string, string>>({});
  const [savingTenantIds, setSavingTenantIds] = useState<Record<string, boolean>>({});
  const [savedTenantFeedback, setSavedTenantFeedback] = useState<Record<string, boolean>>({});
  const [tenantFilterQuery, setTenantFilterQuery] = useState('');
  const [customizingTenant, setCustomizingTenant] = useState<Company | null>(null);

  // Custom Customer Package Form State
  const [customPkgName, setCustomPkgName] = useState('');
  const [customPkgPrice, setCustomPkgPrice] = useState(49);
  const [customMaxBranches, setCustomMaxBranches] = useState(3);
  const [customMaxStaff, setCustomMaxStaff] = useState(10);
  const [customFeatures, setCustomFeatures] = useState<Record<string, boolean>>({});
  const [customSearchFilter, setCustomSearchFilter] = useState('');

  useEffect(() => {
    const handleUpdate = () => {
      const updated = getPackages();
      setPackages(updated);
      setCompanies(getCompanies());
    };
    window.addEventListener('saas_packages_updated', handleUpdate);
    return () => window.removeEventListener('saas_packages_updated', handleUpdate);
  }, []);

  // Initialize staged packages for all companies
  useEffect(() => {
    setStagedTenantPackages((prev) => {
      const next = { ...prev };
      companies.forEach((comp) => {
        if (!next[comp.company_id]) {
          const defaultPkgId =
            (comp as any).package_id ||
            packages.find((p) => p.code?.toUpperCase() === comp.plan?.toUpperCase())?.id ||
            packages[0]?.id;
          if (defaultPkgId) {
            next[comp.company_id] = defaultPkgId;
          }
        }
      });
      return next;
    });
  }, [companies, packages]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleSelectPackage = (pkg: SaaSPackage) => {
    setSelectedPackage(pkg);
    setIsEditing(false);
    setIsCreatingNew(false);
  };

  const startEditPackage = (pkg: SaaSPackage) => {
    setSelectedPackage(pkg);
    setEditName(pkg.name);
    setEditCode(pkg.code);
    setEditTier(pkg.tier);
    setEditDesc(pkg.description);
    setEditPriceMonthly(pkg.priceMonthly);
    setEditPriceAnnual(pkg.priceAnnual);
    setEditMaxBranches(pkg.maxBranches);
    setEditMaxStaff(pkg.maxStaff);
    setEditIsDefault(pkg.isDefault);
    setEditFeatures({ ...pkg.features });
    setIsEditing(true);
    setIsCreatingNew(false);
  };

  const startCreatePackage = () => {
    const proDefaults: Record<string, boolean> = {};
    ALL_APP_FUNCTIONS.forEach((fn) => {
      proDefaults[fn.id] = fn.defaultPro;
    });

    setEditName('Custom Retail Package');
    setEditCode(`CUSTOM_${Date.now().toString().slice(-4)}`);
    setEditTier('CUSTOM');
    setEditDesc('Custom package with tailored feature permissions.');
    setEditPriceMonthly(29);
    setEditPriceAnnual(290);
    setEditMaxBranches(2);
    setEditMaxStaff(5);
    setEditIsDefault(false);
    setEditFeatures(proDefaults);
    setIsEditing(true);
    setIsCreatingNew(true);
  };

  const handleToggleFeature = (featureId: string) => {
    setEditFeatures((prev) => ({
      ...prev,
      [featureId]: !prev[featureId],
    }));
  };

  const handleBulkToggleCategory = (category: AppFunctionCategory, enable: boolean) => {
    setEditFeatures((prev) => {
      const next = { ...prev };
      ALL_APP_FUNCTIONS.filter((fn) => fn.category === category).forEach((fn) => {
        next[fn.id] = enable;
      });
      return next;
    });
  };

  const handleBulkToggleAll = (enable: boolean) => {
    setEditFeatures((prev) => {
      const next = { ...prev };
      ALL_APP_FUNCTIONS.forEach((fn) => {
        next[fn.id] = enable;
      });
      return next;
    });
  };

  const handleResetToStandard = () => {
    const standard: Record<string, boolean> = {};
    ALL_APP_FUNCTIONS.forEach((fn) => {
      standard[fn.id] =
        editTier === 'STARTER'
          ? fn.defaultStarter
          : editTier === 'PROFESSIONAL'
          ? fn.defaultPro
          : fn.defaultEnterprise;
    });
    setEditFeatures(standard);
    showToast(`Reset features to standard ${editTier} defaults`);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      showToast('Please enter a package name');
      return;
    }

    if (isCreatingNew) {
      const created = createPackage({
        name: editName.trim(),
        code: editCode.trim().toUpperCase(),
        tier: editTier,
        description: editDesc.trim(),
        priceMonthly: Number(editPriceMonthly),
        priceAnnual: Number(editPriceAnnual),
        maxBranches: Number(editMaxBranches),
        maxStaff: Number(editMaxStaff),
        isDefault: editIsDefault,
        features: editFeatures,
      });
      setPackages(getPackages());
      setSelectedPackage(created);
      setIsEditing(false);
      setIsCreatingNew(false);
      showToast(`✓ Package '${created.name}' created successfully!`);
      confetti({ particleCount: 30, spread: 60 });
    } else if (selectedPackage) {
      const updated = updatePackage(selectedPackage.id, {
        name: editName.trim(),
        code: editCode.trim().toUpperCase(),
        tier: editTier,
        description: editDesc.trim(),
        priceMonthly: Number(editPriceMonthly),
        priceAnnual: Number(editPriceAnnual),
        maxBranches: Number(editMaxBranches),
        maxStaff: Number(editMaxStaff),
        isDefault: editIsDefault,
        features: editFeatures,
      });
      setPackages(getPackages());
      if (updated) setSelectedPackage(updated);
      setIsEditing(false);
      showToast(`✓ Package '${editName}' updated with customized functions!`);
      confetti({ particleCount: 35, spread: 60 });
    }
  };

  const handleDeletePackage = (pkg: SaaSPackage) => {
    if (['pkg_starter', 'pkg_professional', 'pkg_enterprise'].includes(pkg.id)) {
      showToast('Default system packages cannot be deleted');
      return;
    }
    if (window.confirm(`Delete package '${pkg.name}'? Tenants on this package will revert to Starter.`)) {
      deletePackage(pkg.id);
      const remaining = getPackages();
      setPackages(remaining);
      setSelectedPackage(remaining[0] || null);
      setIsEditing(false);
      showToast(`Package '${pkg.name}' deleted`);
    }
  };

  const handleAssignTenant = (companyId: string, packageId: string) => {
    // Stage the selection first so the user sees their change and can save it explicitly
    setStagedTenantPackages((prev) => ({
      ...prev,
      [companyId]: packageId,
    }));
  };

  const handleSaveTenantPackage = (companyId: string) => {
    const targetPackageId = stagedTenantPackages[companyId];
    if (!targetPackageId) return;

    setSavingTenantIds((prev) => ({ ...prev, [companyId]: true }));

    setTimeout(() => {
      const success = assignCompanyPackage(companyId, targetPackageId);
      if (success) {
        const updatedComps = getCompanies();
        setCompanies(updatedComps);
        const comp = updatedComps.find((c) => c.company_id === companyId);
        const p = packages.find((x) => x.id === targetPackageId);
        showToast(`✓ Package '${p?.name || targetPackageId}' successfully saved for ${comp?.company_name || 'tenant'}!`);
        
        setSavedTenantFeedback((prev) => ({ ...prev, [companyId]: true }));
        setTimeout(() => {
          setSavedTenantFeedback((prev) => {
            const copy = { ...prev };
            delete copy[companyId];
            return copy;
          });
        }, 3000);

        try {
          confetti({ particleCount: 35, spread: 55, origin: { y: 0.6 } });
        } catch {
          // ignore
        }
      } else {
        showToast('Failed to save tenant package');
      }
      setSavingTenantIds((prev) => ({ ...prev, [companyId]: false }));
    }, 200);
  };

  const handleSaveAllTenantPackages = () => {
    let savedCount = 0;
    companies.forEach((comp) => {
      const stagedId = stagedTenantPackages[comp.company_id];
      const currentPkgId =
        (comp as any).package_id ||
        packages.find((p) => p.code?.toUpperCase() === comp.plan?.toUpperCase())?.id ||
        packages[0]?.id;
      if (stagedId && stagedId !== currentPkgId) {
        assignCompanyPackage(comp.company_id, stagedId);
        savedCount++;
      }
    });

    if (savedCount > 0) {
      setCompanies(getCompanies());
      showToast(`✓ Successfully saved packages for ${savedCount} tenant(s)!`);
      try {
        confetti({ particleCount: 70, spread: 75, origin: { y: 0.6 } });
      } catch {
        // ignore
      }
    } else {
      showToast('All tenant packages are already up-to-date and saved');
    }
  };

  const handleOpenCustomTenantPackageModal = (comp: Company) => {
    const currentPkgId =
      (comp as any).package_id ||
      packages.find((p) => p.code?.toUpperCase() === comp.plan?.toUpperCase())?.id ||
      packages[0]?.id;
    const currentPkg = packages.find((p) => p.id === currentPkgId) || packages[0];

    setCustomizingTenant(comp);
    setCustomPkgName(`Custom Plan - ${comp.company_name}`);
    setCustomPkgPrice(currentPkg?.priceMonthly || 49);
    setCustomMaxBranches(currentPkg?.maxBranches || 3);
    setCustomMaxStaff(currentPkg?.maxStaff || 10);
    setCustomFeatures({ ...(currentPkg?.features || {}) });
    setCustomSearchFilter('');
  };

  const handleSaveCustomTenantPackage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customizingTenant) return;

    const newPkg = createPackage({
      name: customPkgName.trim() || `Custom - ${customizingTenant.company_name}`,
      code: `CUST_${customizingTenant.company_id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`,
      tier: 'CUSTOM',
      description: `Dedicated custom package tailored for ${customizingTenant.company_name}`,
      priceMonthly: Number(customPkgPrice) || 0,
      priceAnnual: (Number(customPkgPrice) || 0) * 10,
      maxBranches: Number(customMaxBranches) || 1,
      maxStaff: Number(customMaxStaff) || 3,
      isDefault: false,
      features: customFeatures,
    });

    // Assign to company and persist immediately
    assignCompanyPackage(customizingTenant.company_id, newPkg.id);
    const updatedComps = getCompanies();
    setCompanies(updatedComps);
    setPackages(getPackages());
    setStagedTenantPackages((prev) => ({
      ...prev,
      [customizingTenant.company_id]: newPkg.id,
    }));

    showToast(`✓ Custom package '${newPkg.name}' created and saved for ${customizingTenant.company_name}!`);
    try {
      confetti({ particleCount: 55, spread: 65, origin: { y: 0.6 } });
    } catch {
      // ignore
    }
    setCustomizingTenant(null);
  };

  // Filtered functions
  const filteredFunctions = useMemo(() => {
    return ALL_APP_FUNCTIONS.filter((fn) => {
      const matchCat = selectedCategory === 'ALL' || fn.category === selectedCategory;
      const q = (featureSearch || '').toLowerCase().trim();
      const matchSearch =
        !q ||
        fn.name.toLowerCase().includes(q) ||
        fn.description.toLowerCase().includes(q) ||
        fn.categoryLabel.toLowerCase().includes(q) ||
        fn.id.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [selectedCategory, featureSearch]);

  const categories: Array<{ id: AppFunctionCategory | 'ALL'; label: string }> = [
    { id: 'ALL', label: 'All Functions (45)' },
    { id: 'pos', label: 'Point of Sale' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'purchasing', label: 'Suppliers & PO' },
    { id: 'customers', label: 'Customers & CRM' },
    { id: 'cash_balancing', label: 'Cash & Forms 1-4' },
    { id: 'multi_branch', label: 'Multi-Branch' },
    { id: 'reports', label: 'Reports' },
    { id: 'security_system', label: 'System & Security' },
  ];

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Banner & Mode Switcher */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-black text-white">SaaS Package & Tier Customizer</h3>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                Super Admin Exclusive
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Define subscription packages and customize which of the 45 application functions are unlocked for each tenant.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-1 flex items-center">
            <button
              type="button"
              onClick={() => setActiveTab('PACKAGES')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'PACKAGES'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Packages & Tiers ({packages.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('TENANT_ASSIGNMENTS')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'TENANT_ASSIGNMENTS'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Tenant Subscriptions ({companies.length})
            </button>
          </div>

          <button
            type="button"
            onClick={startCreatePackage}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 cursor-pointer active:scale-95 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create Package</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: PACKAGES & PERMISSIONS MATRIX */}
      {activeTab === 'PACKAGES' && (
        <div className="space-y-4">
          {/* Package Cards Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {packages.map((pkg) => {
              const isSelected = selectedPackage?.id === pkg.id;
              const enabledCount = Object.values(pkg.features || {}).filter(Boolean).length;
              const tenantCount = companies.filter((c) => {
                if ((c as any).package_id) return (c as any).package_id === pkg.id;
                return c.plan?.toUpperCase() === pkg.code?.toUpperCase();
              }).length;

              return (
                <div
                  key={pkg.id}
                  onClick={() => handleSelectPackage(pkg)}
                  className={`p-4 rounded-2xl border transition cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                    isSelected
                      ? 'bg-slate-900 border-amber-500/80 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/50'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            pkg.tier === 'STARTER'
                              ? 'bg-blue-400'
                              : pkg.tier === 'PROFESSIONAL'
                              ? 'bg-purple-400'
                              : pkg.tier === 'ENTERPRISE'
                              ? 'bg-emerald-400'
                              : 'bg-amber-400'
                          }`}
                        />
                        <h4 className="font-bold text-sm text-white">{pkg.name}</h4>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {pkg.isDefault && (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                            DEFAULT
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-mono font-bold">
                          {pkg.code}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{pkg.description}</p>

                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-xl font-black text-white">${pkg.priceMonthly}</span>
                      <span className="text-xs text-slate-400">/ month</span>
                      <span className="text-[11px] text-slate-500">(${pkg.priceAnnual}/yr)</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-[11px]">
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Max Branches</span>
                        <span className="font-bold text-slate-200">
                          {pkg.maxBranches >= 999 ? 'Unlimited' : pkg.maxBranches}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Max Staff</span>
                        <span className="font-bold text-slate-200">
                          {pkg.maxStaff >= 999 ? 'Unlimited' : pkg.maxStaff}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Active Tenants</span>
                        <span className="font-bold text-amber-300">{tenantCount}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Zap className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-slate-300 font-bold">{enabledCount} of 45</span>
                      <span className="text-slate-500 text-[11px]">functions</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditPackage(pkg);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1 border border-slate-700 transition"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      {!['pkg_starter', 'pkg_professional', 'pkg_enterprise'].includes(pkg.id) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePackage(pkg);
                          }}
                          className="p-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 transition"
                          title="Delete package"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* EDITING / CREATION PANEL */}
          {isEditing && (
            <div className="p-4 sm:p-5 rounded-3xl bg-slate-900 border border-amber-500/50 shadow-2xl space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                    <Sliders className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">
                      {isCreatingNew ? 'Create New Application Package' : `Customizing: ${selectedPackage?.name}`}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Configure package pricing, limits, and toggle each application function
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetToStandard}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Defaults</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const form = document.getElementById('package-edit-form') as HTMLFormElement;
                      if (form) form.requestSubmit();
                    }}
                    className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-lg shadow-amber-500/20 active:scale-95 transition cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Package</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <form id="package-edit-form" onSubmit={handleSave} className="space-y-4">
                {/* General Settings */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold uppercase text-slate-400">Package Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      placeholder="e.g. Starter Retail POS"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold uppercase text-slate-400">Package Code / Tier</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                        required
                        placeholder="CODE"
                        className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase focus:outline-none focus:border-amber-500"
                      />
                      <select
                        value={editTier}
                        onChange={(e) => setEditTier(e.target.value as any)}
                        className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      >
                        <option value="STARTER">STARTER</option>
                        <option value="PROFESSIONAL">PROFESSIONAL</option>
                        <option value="ENTERPRISE">ENTERPRISE</option>
                        <option value="CUSTOM">CUSTOM</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold uppercase text-slate-400">Monthly Price ($)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        value={editPriceMonthly}
                        onChange={(e) => setEditPriceMonthly(Number(e.target.value))}
                        className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      />
                      <input
                        type="number"
                        min="0"
                        value={editPriceAnnual}
                        onChange={(e) => setEditPriceAnnual(Number(e.target.value))}
                        placeholder="Annual"
                        className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                        title="Annual Price ($)"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold uppercase text-slate-400">Max Branches & Staff</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={editMaxBranches}
                        onChange={(e) => setEditMaxBranches(Number(e.target.value))}
                        title="Max Branches (999 for unlimited)"
                        placeholder="Branches"
                        className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      />
                      <input
                        type="number"
                        min="1"
                        max="999"
                        value={editMaxStaff}
                        onChange={(e) => setEditMaxStaff(Number(e.target.value))}
                        title="Max Staff Users (999 for unlimited)"
                        placeholder="Staff"
                        className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-[11px] font-bold uppercase text-slate-400">Description</label>
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Brief summary of package target audience and included features"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-300 font-bold cursor-pointer pt-4">
                    <input
                      type="checkbox"
                      checked={editIsDefault}
                      onChange={(e) => setEditIsDefault(e.target.checked)}
                      className="w-4 h-4 rounded text-amber-500 focus:ring-0"
                    />
                    <span>Default Signup Plan</span>
                  </label>
                </div>

                {/* 45 Application Functions Matrix Header */}
                <div className="pt-3 border-t border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div>
                      <h4 className="font-bold text-sm text-white flex items-center gap-2">
                        <span>Application Functions & Capabilities</span>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-mono font-bold">
                          {Object.values(editFeatures).filter(Boolean).length} / 45 Enabled
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Toggle any function to immediately allow or restrict that capability for tenants subscribed to this package.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleBulkToggleAll(true)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 text-xs font-bold border border-emerald-700/50"
                      >
                        Enable All 45
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkToggleAll(false)}
                        className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-bold border border-rose-700/50"
                      >
                        Disable All
                      </button>
                    </div>
                  </div>

                  {/* Filter and Search Bar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={featureSearch}
                        onChange={(e) => setFeatureSearch(e.target.value)}
                        placeholder="Search all 45 functions (e.g. discount, barcode, mesh, GRV, credit)..."
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 placeholder:text-slate-500"
                      />
                    </div>

                    <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs no-scrollbar">
                      {categories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap transition cursor-pointer ${
                            selectedCategory === cat.id
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300 hover:text-white'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Functions Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto pr-1">
                    {filteredFunctions.map((fn) => {
                      const isEnabled = Boolean(editFeatures[fn.id]);
                      return (
                        <div
                          key={fn.id}
                          onClick={() => handleToggleFeature(fn.id)}
                          className={`p-3 rounded-xl border transition cursor-pointer flex items-start justify-between gap-2.5 ${
                            isEnabled
                              ? 'bg-indigo-950/40 border-indigo-500/50 shadow-sm'
                              : 'bg-slate-950/40 border-slate-800/80 opacity-60 hover:opacity-90'
                          }`}
                        >
                          <div className="space-y-0.5 flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.2 rounded border border-slate-800">
                                {fn.categoryLabel}
                              </span>
                            </div>
                            <h5 className="font-bold text-xs text-white truncate">{fn.name}</h5>
                            <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                              {fn.description}
                            </p>
                          </div>

                          <div
                            className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition ${
                              isEnabled
                                ? 'bg-emerald-500 text-slate-950 font-bold'
                                : 'bg-slate-800 text-slate-500 border border-slate-700'
                            }`}
                          >
                            {isEnabled ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <X className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/20 active:scale-95 transition cursor-pointer"
                  >
                    Save Package &amp; Feature Configurations
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* READ-ONLY FEATURE PREVIEW FOR SELECTED PACKAGE */}
          {!isEditing && selectedPackage && (
            <div className="p-4 sm:p-5 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-black text-base shadow-md">
                    {selectedPackage.name.slice(0, 1)}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white flex items-center gap-2">
                      <span>{selectedPackage.name}</span>
                      <span className="text-xs font-normal text-slate-400">
                        ({Object.values(selectedPackage.features || {}).filter(Boolean).length} of 45 functions enabled)
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Tier: <span className="text-amber-400 font-mono font-bold">{selectedPackage.code}</span> &bull; Max Branches: {selectedPackage.maxBranches >= 999 ? 'Unlimited' : selectedPackage.maxBranches} &bull; Max Staff: {selectedPackage.maxStaff >= 999 ? 'Unlimited' : selectedPackage.maxStaff}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => startEditPackage(selectedPackage)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-md shadow-amber-500/20 active:scale-95 transition cursor-pointer self-start sm:self-auto"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Customize Functions</span>
                </button>
              </div>

              {/* Function list preview categorized */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
                {ALL_APP_FUNCTIONS.map((fn) => {
                  const isEnabled = Boolean(selectedPackage.features?.[fn.id]);
                  return (
                    <div
                      key={fn.id}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                        isEnabled
                          ? 'bg-slate-950/60 border-slate-800 text-slate-200'
                          : 'bg-slate-950/20 border-slate-900 text-slate-600'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold block truncate">{fn.name}</span>
                        <span className="text-[10px] text-slate-500">{fn.categoryLabel}</span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                          isEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {isEnabled ? 'ENABLED' : 'LOCKED'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: TENANT SUBSCRIPTION ASSIGNMENTS */}
      {activeTab === 'TENANT_ASSIGNMENTS' && (
        <div className="space-y-4">
          <div className="p-4 sm:p-5 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-bold text-sm text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-amber-400" />
                  <span>Assign &amp; Save Packages for Registered Tenants</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Select a package for any tenant and click <strong className="text-emerald-400">"Save Package"</strong> to commit the plan, POS limits, and enabled capabilities.
                </p>
              </div>

              {/* Action Buttons & Counters */}
              <div className="flex items-center gap-2.5 flex-wrap">
                {(() => {
                  const unsavedCount = companies.filter((comp) => {
                    const currentPkgId =
                      (comp as any).package_id ||
                      packages.find((p) => p.code?.toUpperCase() === comp.plan?.toUpperCase())?.id ||
                      packages[0]?.id;
                    const stagedId = stagedTenantPackages[comp.company_id] || currentPkgId;
                    return stagedId !== currentPkgId;
                  }).length;

                  if (unsavedCount > 0) {
                    return (
                      <button
                        type="button"
                        onClick={handleSaveAllTenantPackages}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-lg shadow-emerald-600/30 flex items-center gap-2 active:scale-95 transition cursor-pointer animate-pulse"
                      >
                        <Save className="w-4 h-4" />
                        <span>Save All Tenant Packages ({unsavedCount})</span>
                      </button>
                    );
                  }
                  return null;
                })()}

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={tenantFilterQuery}
                    onChange={(e) => setTenantFilterQuery(e.target.value)}
                    placeholder="Search tenant or email..."
                    className="bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-48 sm:w-60"
                  />
                  {tenantFilterQuery && (
                    <button
                      type="button"
                      onClick={() => setTenantFilterQuery('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Tenants Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold text-[10px]">
                    <th className="py-2.5 px-3">Company / Tenant</th>
                    <th className="py-2.5 px-3">Owner Contact</th>
                    <th className="py-2.5 px-3">Current Active Plan</th>
                    <th className="py-2.5 px-3">Package Selection</th>
                    <th className="py-2.5 px-3 text-right">Save &amp; Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {companies
                    .filter((comp) => {
                      if (!tenantFilterQuery.trim()) return true;
                      const q = tenantFilterQuery.toLowerCase();
                      return (
                        comp.company_name?.toLowerCase().includes(q) ||
                        comp.company_id?.toLowerCase().includes(q) ||
                        comp.owner_email?.toLowerCase().includes(q) ||
                        comp.owner_name?.toLowerCase().includes(q)
                      );
                    })
                    .map((comp) => {
                      const currentPkgId =
                        (comp as any).package_id ||
                        packages.find(
                          (p) => p.code?.toUpperCase() === comp.plan?.toUpperCase()
                        )?.id ||
                        packages[0]?.id;

                      const stagedPkgId = stagedTenantPackages[comp.company_id] || currentPkgId;
                      const isUnsaved = stagedPkgId !== currentPkgId;
                      const isSaving = savingTenantIds[comp.company_id];
                      const isSaved = savedTenantFeedback[comp.company_id];

                      const currentPkg = packages.find((p) => p.id === currentPkgId) || packages[0];
                      const stagedPkg = packages.find((p) => p.id === stagedPkgId) || currentPkg;

                      return (
                        <tr
                          key={comp.company_id}
                          className={`transition ${
                            isUnsaved ? 'bg-amber-950/20 border-l-2 border-amber-500' : 'hover:bg-slate-800/30'
                          }`}
                        >
                          {/* Tenant Info */}
                          <td className="py-3 px-3">
                            <span className="font-bold text-white block text-sm">{comp.company_name}</span>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono mt-0.5">
                              <span className="text-amber-400/90 font-bold">{comp.company_id}</span>
                              <span>•</span>
                              <span>{comp.business_category || 'Retail Store'}</span>
                            </div>
                          </td>

                          {/* Owner Email */}
                          <td className="py-3 px-3">
                            <div className="text-slate-300 font-mono text-[11px]">{comp.owner_email}</div>
                            {comp.owner_name && (
                              <div className="text-[10px] text-slate-500">{comp.owner_name}</div>
                            )}
                          </td>

                          {/* Current Plan */}
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-amber-300 font-mono font-bold text-[10px] border border-slate-700">
                                {comp.plan || 'STARTER'}
                              </span>
                              {comp.subscription_status && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                  comp.subscription_status === 'ACTIVE'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-blue-500/20 text-blue-300'
                                }`}>
                                  {comp.subscription_status}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                              <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                              <span className="font-medium text-slate-300">{currentPkg?.name}</span>
                              <span className="text-slate-500">
                                ({Object.values(currentPkg?.features || {}).filter(Boolean).length}/45 fn)
                              </span>
                            </div>
                          </td>

                          {/* Package Dropdown Selector */}
                          <td className="py-3 px-3">
                            <div className="space-y-1">
                              <select
                                value={stagedPkgId}
                                onChange={(e) => handleAssignTenant(comp.company_id, e.target.value)}
                                className={`w-full max-w-xs bg-slate-950 border rounded-xl px-3 py-1.5 text-xs text-white font-medium focus:outline-none ${
                                  isUnsaved
                                    ? 'border-amber-500 shadow-md shadow-amber-500/20 ring-1 ring-amber-500'
                                    : 'border-slate-700 focus:border-amber-500'
                                }`}
                              >
                                {packages.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} — ${p.priceMonthly}/mo ({Object.values(p.features || {}).filter(Boolean).length} functions)
                                  </option>
                                ))}
                              </select>

                              {isUnsaved && (
                                <div className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                                  <span>● Unsaved change:</span>
                                  <span className="text-white underline">{stagedPkg?.name}</span>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Save & Action Buttons */}
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Prominent Save Package Button */}
                              <button
                                type="button"
                                onClick={() => handleSaveTenantPackage(comp.company_id)}
                                disabled={isSaving}
                                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition cursor-pointer ${
                                  isSaved
                                    ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-400'
                                    : isUnsaved
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 animate-pulse font-black'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                                }`}
                                title="Save this package assignment for this tenant"
                              >
                                {isSaving ? (
                                  <>
                                    <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                                    <span>Saving...</span>
                                  </>
                                ) : isSaved ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                    <span>Saved ✓</span>
                                  </>
                                ) : (
                                  <>
                                    <Save className="w-3.5 h-3.5" />
                                    <span>Save Package</span>
                                  </>
                                )}
                              </button>

                              {/* Customize Specifically for this Customer */}
                              <button
                                type="button"
                                onClick={() => handleOpenCustomTenantPackageModal(comp)}
                                className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                                title="Create or edit a custom tailored package for this customer"
                              >
                                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CUSTOMIZE PACKAGE FOR SPECIFIC CUSTOMER */}
      {customizingTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-2xl bg-slate-900 border border-amber-500/50 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">
                    Customize Package for: {customizingTenant.company_name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Tenant ID: {customizingTenant.company_id} • Owner: {customizingTenant.owner_email}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const form = document.getElementById('custom-tenant-pkg-form') as HTMLFormElement;
                    if (form) form.requestSubmit();
                  }}
                  className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-lg shadow-amber-500/20 active:scale-95 transition cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Customer Package</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCustomizingTenant(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body Form */}
            <form
              id="custom-tenant-pkg-form"
              onSubmit={handleSaveCustomTenantPackage}
              className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold uppercase text-slate-400">Package Title</label>
                  <input
                    type="text"
                    value={customPkgName}
                    onChange={(e) => setCustomPkgName(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold uppercase text-slate-400">Monthly Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={customPkgPrice}
                    onChange={(e) => setCustomPkgPrice(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold uppercase text-slate-400">Max Branches &amp; Staff</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      value={customMaxBranches}
                      onChange={(e) => setCustomMaxBranches(Number(e.target.value))}
                      placeholder="Branches"
                      title="Max Branches"
                      className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                    <input
                      type="number"
                      min="1"
                      value={customMaxStaff}
                      onChange={(e) => setCustomMaxStaff(Number(e.target.value))}
                      placeholder="Staff"
                      title="Max Staff Accounts"
                      className="w-1/2 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* 45 Functions Matrix for this tenant */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h5 className="font-bold text-xs text-white">Application Functions for this Customer</h5>
                    <p className="text-[10px] text-slate-400">
                      Enabled: {Object.values(customFeatures).filter(Boolean).length} / 45
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const allOn: Record<string, boolean> = {};
                        ALL_APP_FUNCTIONS.forEach((fn) => { allOn[fn.id] = true; });
                        setCustomFeatures(allOn);
                      }}
                      className="px-2 py-0.5 rounded bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 text-[10px] font-bold border border-emerald-700/50"
                    >
                      Enable All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const allOff: Record<string, boolean> = {};
                        ALL_APP_FUNCTIONS.forEach((fn) => { allOff[fn.id] = false; });
                        setCustomFeatures(allOff);
                      }}
                      className="px-2 py-0.5 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-[10px] font-bold border border-rose-700/50"
                    >
                      Disable All
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={customSearchFilter}
                    onChange={(e) => setCustomSearchFilter(e.target.value)}
                    placeholder="Filter functions..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {ALL_APP_FUNCTIONS.filter((fn) => {
                    if (!customSearchFilter.trim()) return true;
                    const q = customSearchFilter.toLowerCase();
                    return fn.name.toLowerCase().includes(q) || fn.categoryLabel.toLowerCase().includes(q);
                  }).map((fn) => {
                    const isEnabled = Boolean(customFeatures[fn.id]);
                    return (
                      <div
                        key={fn.id}
                        onClick={() =>
                          setCustomFeatures((prev) => ({
                            ...prev,
                            [fn.id]: !prev[fn.id],
                          }))
                        }
                        className={`p-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition ${
                          isEnabled
                            ? 'bg-emerald-950/20 border-emerald-600/50 text-white'
                            : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-xs block truncate">{fn.name}</span>
                          <span className="text-[10px] text-slate-500">{fn.categoryLabel}</span>
                        </div>
                        <div
                          className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                            isEnabled ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {isEnabled ? <Check className="w-3 h-3 stroke-[3]" /> : <X className="w-2.5 h-2.5" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCustomizingTenant(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/20 active:scale-95 transition cursor-pointer flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Customer Package</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
