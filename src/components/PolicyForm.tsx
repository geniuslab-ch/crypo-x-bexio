'use client';

import { useState } from 'react';

interface Values { costBasisMethod: string; tradingFeeTreatment: string; transferWindowHours: number }

const DEFAULTS: Values = { costBasisMethod: 'fifo', tradingFeeTreatment: 'capitalize', transferWindowHours: 48 };

/**
 * Accounting methods form. Once a choice is saved the fields stay read-only and « Enregistrer » is greyed out;
 * « Modifier » first shows what a change does (recalculated drafts, cancelled fiduciary review) and what it cannot do
 * (validated entries and closed years never change). The server enforces the same locks.
 */
export function PolicyForm({ action, saved, everSaved, methodLocked, texts }: {
  action: (form: FormData) => void | Promise<void>;
  saved: Values;
  everSaved: boolean;
  /** Validated/synced entries or a closed year: the method and the fee treatment can no longer change. */
  methodLocked: boolean;
  texts: {
    method: string; fifo: string; wac: string; fees: string; capitalize: string; expense: string; window: string;
    save: string; edit: string; cancel: string; defaults: string; confirm: string; noChange: string; savedState: string;
    warnTitle: string; warnings: string[]; lockNotes: string[];
  };
}) {
  const [mode, setMode] = useState<'locked' | 'warning' | 'editing'>(everSaved ? 'locked' : 'editing');
  const [v, setV] = useState<Values>(saved);
  const editing = mode === 'editing';
  const dirty = v.costBasisMethod !== saved.costBasisMethod || v.tradingFeeTreatment !== saved.tradingFeeTreatment
    || v.transferWindowHours !== saved.transferWindowHours;
  // The first save records the default choice; afterwards only a real change can be saved.
  const canSave = editing && (dirty || !everSaved);
  const methodDisabled = !editing || methodLocked;
  const cancel = () => { setV(saved); setMode('locked'); };

  return (
    <form action={action} className="stack">
      <label>{texts.method}<select name="costBasisMethod" value={v.costBasisMethod} disabled={methodDisabled}
        onChange={(e) => setV({ ...v, costBasisMethod: e.target.value })}>
        <option value="fifo">{texts.fifo}</option><option value="wac">{texts.wac}</option>
      </select></label>
      <label>{texts.fees}<select name="tradingFeeTreatment" value={v.tradingFeeTreatment} disabled={methodDisabled}
        onChange={(e) => setV({ ...v, tradingFeeTreatment: e.target.value })}>
        <option value="capitalize">{texts.capitalize}</option><option value="expense">{texts.expense}</option>
      </select></label>
      {/* Disabled fields are not submitted: keep the saved values so the server never falls back to its defaults. */}
      {methodDisabled && <>
        <input type="hidden" name="costBasisMethod" value={v.costBasisMethod} />
        <input type="hidden" name="tradingFeeTreatment" value={v.tradingFeeTreatment} />
      </>}
      <label>{texts.window}<input type="number" name="transferWindowHours" min={1} max={720} value={v.transferWindowHours} readOnly={!editing}
        onChange={(e) => setV({ ...v, transferWindowHours: Number(e.target.value) })} /></label>

      {mode === 'locked' && <p className="small muted" style={{ margin: 0 }}>{texts.savedState}</p>}

      {(mode === 'warning' || (editing && everSaved)) && (
        <div className="alert alert-warn small stack" style={{ gap: 6 }}>
          <b>{texts.warnTitle}</b>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {texts.lockNotes.map((n) => <li key={n}>{n}</li>)}
            {texts.warnings.map((n) => <li key={n}>{n}</li>)}
          </ul>
          {mode === 'warning' && (
            <div className="row">
              <button className="btn btn-dark" type="button" onClick={() => setMode('editing')}>{texts.confirm}</button>
              <button className="btn" type="button" onClick={cancel}>{texts.cancel}</button>
            </div>
          )}
        </div>
      )}

      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={!canSave} title={canSave ? undefined : texts.noChange}>{texts.save}</button>
        {mode === 'locked' && <button className="btn" type="button" onClick={() => setMode('warning')}>{texts.edit}</button>}
        {editing && <button className="btn" type="button"
          onClick={() => setV(methodLocked ? { ...v, transferWindowHours: DEFAULTS.transferWindowHours } : DEFAULTS)}>{texts.defaults}</button>}
        {editing && everSaved && <button className="btn" type="button" onClick={cancel}>{texts.cancel}</button>}
      </div>
    </form>
  );
}
