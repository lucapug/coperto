import { useState } from 'react';
import type { AddPartyInput } from '../services/api';

interface Props {
  onSubmit: (input: AddPartyInput) => Promise<void>;
}

const field =
  'w-full min-h-11 rounded-xl border-2 border-stone-300 px-3 text-base font-normal';

export default function AddPartyForm({ onSubmit }: Props) {
  const [name, setName] = useState('');
  const [size, setSize] = useState('2');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [estimatedWait, setEstimatedWait] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedSize = Number(size);
    const parsedWait = estimatedWait.trim() === '' ? undefined : Number(estimatedWait);
    if (!name.trim()) {
      setValidationError('Name is required');
      return;
    }
    if (!phone.trim()) {
      setValidationError('Phone is required');
      return;
    }
    if (!Number.isInteger(parsedSize) || parsedSize < 1) {
      setValidationError('Party size must be at least 1');
      return;
    }
    if (parsedWait !== undefined && (!Number.isInteger(parsedWait) || parsedWait < 0)) {
      setValidationError('Estimated wait must be a number of minutes');
      return;
    }
    setValidationError(null);
    setBusy(true);
    try {
      await onSubmit({
        name,
        size: parsedSize,
        phone,
        notes: notes || undefined,
        estimatedWaitMinutes: parsedWait,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl bg-stone-50 p-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-bold uppercase tracking-wide">
          Name
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold uppercase tracking-wide">
          Party size
          <input
            className={field}
            type="number"
            min={1}
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold uppercase tracking-wide">
          Phone
          <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold uppercase tracking-wide">
          Est. wait (min)
          <input
            className={field}
            type="number"
            min={0}
            value={estimatedWait}
            onChange={(e) => setEstimatedWait(e.target.value)}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm font-bold uppercase tracking-wide">
          Notes
          <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {validationError && (
        <p role="alert" className="text-base font-bold text-red-700">
          {validationError}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        Add party
      </button>
    </form>
  );
}
