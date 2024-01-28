import type {Metadata} from 'next';
import {Inter, Roboto_Mono} from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import React from 'react';
import {cn} from '@/lib/utils';
import {GraduationCapIcon} from 'lucide-react';

const inter = Inter({subsets: ['latin']});
const roboto_mono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'UST Rankings',
  description: 'The Rankings of Instructors at HKUST. ',
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang='en'>
      <body className={cn(inter.className, roboto_mono.variable, 'min-h-screen')}>
        <header className='flex h-16 items-center px-8 text-white bg-[#003366] text-md font-medium '>
          <Link href='/'><GraduationCapIcon className='h-8 w-8'/></Link>
          <div className='m-auto'/>
          <Link className='hover:underline underline-offset-4' href='/faq/'>FAQ</Link>
        </header>
        <main className='flex flex-col items-center space-y-8 text-center py-32'>
          {children}
        </main>
      </body>
    </html>
  );
}
