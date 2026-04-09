import React from 'react';
import { StatusColor } from '../lib/types';

interface Props {
  color: StatusColor;
  label: string;
  size?: 'sm' | 'md';
}

const colorMap: Record<StatusColor, string> = {
  green:  'status-green',
  yellow: 'status-yellow',
  red:    'status-red',
  orange: 'status-orange',
  gray:   'status-gray',
};

const dotMap: Record<StatusColor, string> = {
  green:  'bg-emerald-400',
  yellow: 'bg-yellow-400',
  red:    'bg-red-400 animate-pulse',
  orange: 'bg-orange-400',
  gray:   'bg-slate-500',
};

export function StatusBadge({ color, label, size = 'sm' }: Props) {
  const padding = size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium ${padding} ${colorMap[color]}`}>
      <span className={`h-2 w-2 rounded-full shrink-0 ${dotMap[color]}`} />
      <span className="truncate">{label}</span>
    </span>
  );
}
