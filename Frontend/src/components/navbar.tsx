import { useState, useEffect } from 'react';
import { getCurrentUser } from '../utils/api';
import logo from '../assets/Branding/BP_logo_white.png';

export default function Navbar() {
    const [user, setUser] = useState<{ name?: string; email?: string } | null>(null);
    const [activeTab, setActiveTab] = useState('books');

    useEffect(() => {
        const loadUser = async () => {
            const res = await getCurrentUser();
            if (res.success) {
                setUser(res.data);
            }
        };
        loadUser();
    }, []);

    const handleLogout = () => {
        logout();
        window.location.reload();
    };

    const navTabs = [
        { id: 'books', label: 'Books' },
        { id: 'marketing', label: 'Marketing' },
        { id: 'repurpose', label: 'Repurpose' },
        { id: 'analytics', label: 'Analytics' },
        { id: 'settings', label: 'Settings' },
    ];

    return (
        <nav className='flex justify-between items-center px-6 py-4 bg-[#0a1a2e] border-b border-[#1a2a3a] '>
            {/* Left: Logo */}
            <div className='flex items-center gap-4'>
                <img src={logo} alt="BookPilot" className='h-8 w-auto' />
            </div>

            {/* Center: Navigation Tabs */}
            <div className='flex items-center gap-1'>
                {navTabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${
                            activeTab === tab.id
                                ? 'bg-[#2d4a3e] border border-[#4ade80] text-white'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        {tab.id === 'books' && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                        )}
                        {tab.id === 'marketing' && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                            </svg>
                        )}
                        {tab.id === 'repurpose' && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                        )}
                        {tab.id === 'analytics' && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                        )}
                        {tab.id === 'settings' && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        )}
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Right: User Profile */}
            <div className='flex items-center gap-3'>
                <div className='text-right'>
                    <div className='text-white text-sm font-medium'>
                        {user?.name || user?.email?.split('@')[0] || 'User'}
                    </div>
                    <div className='text-gray-400 text-xs'>
                        {user?.email || 'user@example.com'}
                    </div>
                </div>
                <div className='w-10 h-10 rounded-full bg-[#2d4a3e] flex items-center justify-center border border-[#4ade80]'>
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                </div>
            </div>
        </nav>
    );
}