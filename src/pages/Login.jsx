import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function Login() {
  const { signInWithMagicLink, isSupabaseConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);

  const sendLink = async () => {
    if (!isSupabaseConfigured) {
      toast.error('Supabase is not configured for this deployment.');
      return;
    }
    if (!email || !email.includes('@')) {
      toast.error('Enter a valid email');
      return;
    }
    setIsSending(true);
    try {
      await signInWithMagicLink(email.trim());
      toast.success('Check your email for a sign-in link.');
    } catch (e) {
      toast.error(e?.message || 'Failed to send link');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Enter your email and we will send you a magic link to sign in.
          </p>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendLink();
            }}
          />
          <Button className="w-full bg-green-600 hover:bg-green-700" onClick={sendLink} disabled={isSending}>
            Send sign-in link
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

