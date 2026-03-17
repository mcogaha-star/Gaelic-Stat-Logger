import React from 'react';
import { Link } from 'react-router-dom';
import { Info, ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { createPageUrl } from '@/utils';

export default function About() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link to={createPageUrl('Home')}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          </Link>
          <div className="text-sm text-slate-500">About</div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
                <Info className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-xl font-semibold text-slate-900">Gaelic Stats Logger</div>
                <div className="text-sm text-slate-500">Match analysis and performance tracking</div>
              </div>
            </div>

            <div className="text-sm text-slate-700 space-y-2">
              <p>
                This app is designed to help log match events quickly on a pitch map and export the data for analysis.
              </p>
              <p>
                For privacy information, see the Privacy page.
              </p>
            </div>

            <div className="mt-4">
              <Link to={createPageUrl('Privacy')}>
                <Button variant="outline">Privacy</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

