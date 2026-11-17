'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button with its status shown right below it: a moving progress bar while the form is being saved,
 * then a full bar and « Enregistré » once the server confirmed the save (`done`).
 */
export function SaveButton({ label, savingLabel, savedLabel, done }: { label: string; savingLabel: string; savedLabel: string; done: boolean }) {
  const { pending } = useFormStatus();
  const show = pending || done;
  return (
    <div className="save-status-wrap">
      <button className="btn" type="submit" disabled={pending}>{label}</button>
      {show && (
        <div className="save-status" role="status" aria-live="polite">
          <div className={`save-bar${pending ? ' save-bar-busy' : ' save-bar-done'}`}><span /></div>
          <span className="small">{pending ? savingLabel : `✓ ${savedLabel}`}</span>
        </div>
      )}
    </div>
  );
}
