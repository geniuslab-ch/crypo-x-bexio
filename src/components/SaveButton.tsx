'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button with its status shown right below it: a moving progress bar while the form is being saved,
 * then a full bar and « Enregistré » once the server confirmed the save (`done`).
 * With `intent`, the button submits intent=<value> and only shows the status when it is the button that was clicked,
 * so several buttons can share one form.
 */
export function SaveButton({ label, savingLabel, savedLabel, done, intent, primary }: {
  label: string; savingLabel: string; savedLabel: string; done: boolean; intent?: string; primary?: boolean;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && (data?.get('intent') ?? '') === (intent ?? '');
  const show = mine || (done && !pending);
  return (
    <div className="save-status-wrap">
      <button className={`btn${primary ? ' btn-primary' : ''}`} type="submit" disabled={pending} name={intent ? 'intent' : undefined} value={intent}>{label}</button>
      {show && (
        <div className="save-status" role="status" aria-live="polite">
          <div className={`save-bar${mine ? ' save-bar-busy' : ' save-bar-done'}`}><span /></div>
          <span className="small">{mine ? savingLabel : `✓ ${savedLabel}`}</span>
        </div>
      )}
    </div>
  );
}
