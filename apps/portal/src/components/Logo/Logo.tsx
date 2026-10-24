import Link from 'next/link';
import { APP_NAME, ROUTES } from '@/constants/app.consts';
import type { LogoProps } from '@components/Logo/Logo.types';

export function Logo({ href = ROUTES.home }: LogoProps) {
    return (
        <Link href={href} className="logo" data-testid="logo">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG brand mark */}
            <img src="/brand/mark.svg" alt="" width={28} height={28} />
            <span>{APP_NAME}</span>
        </Link>
    );
}
