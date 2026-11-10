'use client';

import { useState } from 'react';
import type { FormatGuide } from '@/core/importers/guides';

interface Option { id: string; label: string }

/** Format select for CSV import: the help text, expected columns and example file follow the chosen format. */
export function FormatPicker({ label, autoLabel, options, guides }: { label: string; autoLabel: string; options: Option[]; guides: Record<string, FormatGuide> }) {
  const [id, setId] = useState('');
  const g = id ? guides[id] : undefined;
  return (
    <>
      <label>{label}<select name="parserId" value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">{autoLabel}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select></label>
      {g ? (
        <div className="alert alert-info small stack" style={{ gap: 6 }}>
          <div>{g.where}</div>
          <div>Colonnes attendues : <span className="mono">{g.columns.join(', ')}</span></div>
          <a href={`/api/template?format=${encodeURIComponent(id)}`}>Télécharger un fichier d’exemple pour ce format</a>
        </div>
      ) : (
        <p className="small muted">Détection automatique : le format est reconnu d’après la ligne d’en-tête. Choisissez un format pour voir les colonnes attendues et un exemple.</p>
      )}
    </>
  );
}
