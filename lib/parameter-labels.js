const number = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
export const parameterLabel = value => value == null ? '—' : value >= 1000 ? `${number.format(value / 1000)}T` : `${number.format(value)}B`;

export const hasReportedSize = model => model.parameters_b != null || model.parameters_lower_bound_b != null;
const lowerBoundLabel = model => `${model.parameters_lower_bound_exclusive ? '>' : '≥'}${parameterLabel(model.parameters_lower_bound_b)}`;

export function missingLabel(model, field) {
  if (field === 'parameters_b' && model.parameters_lower_bound_b != null) return lowerBoundLabel(model);
  return { undisclosed: 'Not disclosed', not_applicable: 'Not separately reported', unverified: 'Not verified' }[model.field_status?.[field]] || 'Unknown';
}

export function modelSizeLabel(model) {
  if (model.parameters_b == null) return model.parameters_lower_bound_b != null ? lowerBoundLabel(model) : '—';
  return `${parameterLabel(model.parameters_b)}${model.parameters_scope ? ` ${model.parameters_scope.replaceAll('_', ' ')}` : ''}`;
}

export function activeSizeLabel(model) {
  const phases = Object.entries(model.active_parameters_by_phase_b || {});
  if (phases.length) return phases.map(([phase, value]) => `${parameterLabel(value)} ${phase}`).join(' / ');
  if (model.active_parameters_b == null) return missingLabel(model, 'active_parameters_b');
  return `${parameterLabel(model.active_parameters_b)}${model.active_parameters_scope ? ` ${model.active_parameters_scope.replaceAll('_', ' ')}` : ''}`;
}
