import { useState } from 'react';
import { Plus, Pencil, Trash2, Tags, Award } from 'lucide-react';
import { PageHeader, Card } from '@/components/Page';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field, TextInput, EmptyState } from '@/components/Form';
import { toastSuccess, toastError } from '@/components/Toast';
import { useCategories, useBrands, createNamed, renameNamed, deleteNamed } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Category, Brand } from '@/lib/types';

export function CategoriesPage() {
  const { categories, reload: reloadCats } = useCategories();
  const { brands, reload: reloadBrands } = useBrands();

  const [kind, setKind] = useState<'category' | 'brand'>('category');
  const [editing, setEditing] = useState<Category | Brand | null>(null);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: 'category' | 'brand'; item: Category | Brand } | null>(null);

  const openAdd = (k: 'category' | 'brand') => {
    setKind(k);
    setEditing(null);
    setName('');
    setOpen(true);
  };

  const openEdit = (k: 'category' | 'brand', item: Category | Brand) => {
    setKind(k);
    setEditing(item);
    setName(item.name);
    setOpen(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toastError('Name is required');
    setSaving(true);
    try {
      if (editing) {
        await renameNamed(kind, editing.id, trimmed);
        toastSuccess(`${kind === 'category' ? 'Category' : 'Brand'} updated`);
      } else {
        await createNamed(kind, trimmed);
        toastSuccess(`${kind === 'category' ? 'Category' : 'Brand'} added`);
      }
      setOpen(false);
      kind === 'category' ? reloadCats() : reloadBrands();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not save — name may already exist');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await deleteNamed(deleting.kind, deleting.item.id);
      toastSuccess('Deleted');
      setDeleting(null);
      deleting.kind === 'category' ? reloadCats() : reloadBrands();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Categories & Brands" subtitle="Organise your product catalogue" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card
          title="Categories"
          action={
            <button onClick={() => openAdd('category')} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800">
              <Plus size={13} /> Add
            </button>
          }
        >
          {categories.length === 0 ? (
            <EmptyState icon={<Tags size={32} />} title="No categories" message="Add categories like Shampoo, Soap, Snacks." />
          ) : (
            <ul className="divide-y divide-gray-100 -mx-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5 px-1">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{c.name}</div>
                    <div className="text-[11px] text-gray-400">Since {formatDate(c.created_at)}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit('category', c)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Pencil size={14} /></button>
                    <button onClick={() => setDeleting({ kind: 'category', item: c })} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Brands"
          action={
            <button onClick={() => openAdd('brand')} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800">
              <Plus size={13} /> Add
            </button>
          }
        >
          {brands.length === 0 ? (
            <EmptyState icon={<Award size={32} />} title="No brands" message="Add brands like HUL, ITC, Dabur." />
          ) : (
            <ul className="divide-y divide-gray-100 -mx-1">
              {brands.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2.5 px-1">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{b.name}</div>
                    <div className="text-[11px] text-gray-400">Since {formatDate(b.created_at)}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit('brand', b)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Pencil size={14} /></button>
                    <button onClick={() => setDeleting({ kind: 'brand', item: b })} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Edit ${kind}` : `Add ${kind}`}>
        <Field label="Name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'category' ? 'e.g. Biscuits' : 'e.g. Parle'} />
        </Field>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-700 hover:bg-brand-800 text-white disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.kind ?? ''}?`}
        message={<>Are you sure you want to delete <strong>{deleting?.item.name}</strong>? Products using it will keep working but show no {deleting?.kind}.</>}
        confirmLabel="Delete"
        danger
        loading={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
