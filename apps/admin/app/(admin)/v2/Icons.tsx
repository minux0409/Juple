/** Small line icons (24 x 24, currentColor) for the V2 navigation and cards - inline SVG, no icon package. */
type IconProps = { readonly size?: number; readonly className?: string };

function Svg({ size = 20, className, children }: IconProps & { readonly children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24" width={size}>
      {children}
    </svg>
  );
}

export const DashboardIcon = (p: IconProps) => <Svg {...p}><rect height="7" rx="2" width="7" x="3.5" y="3.5" /><rect height="7" rx="2" width="7" x="13.5" y="3.5" /><rect height="7" rx="2" width="7" x="3.5" y="13.5" /><rect height="7" rx="2" width="7" x="13.5" y="13.5" /></Svg>;
export const UsersIcon = (p: IconProps) => <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.2 14.8c1.8.7 3 2.4 3.3 5.2" /></Svg>;
export const MegaphoneIcon = (p: IconProps) => <Svg {...p}><path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" /></Svg>;
export const InboxIcon = (p: IconProps) => <Svg {...p}><path d="M4 5h16v14H4z" /><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" /></Svg>;
export const WalletIcon = (p: IconProps) => <Svg {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect height="12" rx="2.5" width="17" x="3.5" y="8" /><circle cx="16" cy="14" r="1.2" /></Svg>;
export const PhoneIcon = (p: IconProps) => <Svg {...p}><rect height="18" rx="3" width="11" x="6.5" y="3" /><path d="M11 17.5h2" /></Svg>;
export const ShieldIcon = (p: IconProps) => <Svg {...p}><path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const PulseIcon = (p: IconProps) => <Svg {...p}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></Svg>;
export const LogoutIcon = (p: IconProps) => <Svg {...p}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></Svg>;
export const LinkIcon = (p: IconProps) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>;
export const UserPlusIcon = (p: IconProps) => <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M18.5 8v6M15.5 11h6" /></Svg>;
export const RefreshIcon = (p: IconProps) => <Svg {...p}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" /></Svg>;
export const TranslateIcon = (p: IconProps) => <Svg {...p}><path d="M4 5h9M8.5 3v2M6 5c.7 3.2 2.8 5.7 5.5 7M11 5c-.7 3.4-3 6.3-6.5 8" /><path d="m12.5 20 4-9 4 9M14 17h5" /></Svg>;
export const MenuIcon = (p: IconProps) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
