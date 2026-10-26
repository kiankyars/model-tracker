const number = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
export const billions = value => value == null ? '—' : `${number.format(value)}B`;

export function missingLabel(model, field) {
  return { undisclosed: 'Not disclosed', not_applicable: 'Not separately reported', unverified: 'Not verified' }[model.field_status?.[field]] || 'Unknown';
}

export function modelSizeLabel(model) {
  if (model.parameters_b == null) return '—';
  return `${billions(model.parameters_b)}${model.parameters_scope ? ` ${model.parameters_scope.replaceAll('_', ' ')}` : ''}`;
}

export function activeSizeLabel(model) {
  const phases = Object.entries(model.active_parameters_by_phase_b || {});
  if (phases.length) return phases.map(([phase, value]) => `${billions(value)} ${phase}`).join(' / ');
  if (model.active_parameters_b == null) return missingLabel(model, 'active_parameters_b');
  return `${billions(model.active_parameters_b)}${model.active_parameters_scope ? ` ${model.active_parameters_scope.replaceAll('_', ' ')}` : ''}`;
}
