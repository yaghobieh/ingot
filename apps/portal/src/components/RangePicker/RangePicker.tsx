'use client';

import { USAGE_RANGES } from '@/constants/app.consts';
import { usePortal } from '@components/Providers';
import type { RangePickerProps } from '@components/RangePicker/RangePicker.types';

export function RangePicker({ value, onChange }: RangePickerProps) {
    const { t } = usePortal();
    return (
        <div className="seg" role="group" data-testid="range-picker">
            {USAGE_RANGES.map(days => (
                <button key={days} type="button" aria-pressed={value === days} onClick={() => onChange(days)} data-testid={`range-${days}`}>
                    {t('overview.range', { days })}
                </button>
            ))}
        </div>
    );
}
