import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function Login() {
  const { signInWithMagicLink, signInWithGoogle, isSupabaseConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSendingGoogle, setIsSendingGoogle] = useState(false);

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

  const continueWithGoogle = async () => {
    if (!isSupabaseConfigured) {
      toast.error('Supabase is not configured for this deployment.');
      return;
    }
    setIsSendingGoogle(true);
    try {
      await signInWithGoogle();
      // Supabase will redirect away; if it doesn't, show a gentle hint.
      toast.message('Opening Google sign-in...');
    } catch (e) {
      toast.error(e?.message || 'Failed to start Google sign-in');
      setIsSendingGoogle(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full bg-slate-900 hover:bg-slate-800"
            onClick={continueWithGoogle}
            disabled={isSendingGoogle || isSending}
          >
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-slate-200" />
            <div className="text-xs text-slate-500">or</div>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
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
