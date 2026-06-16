import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Route, Router, Switch } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';

import { queryClient } from './lib/query-client';
import {
  rpc,
  SESSION_EXPIRED_EVENT,
  SESSION_EXPIRED_MESSAGE,
} from './lib/rpc';
import { HomeRoute } from './routes/home';
import { SignInRoute } from './routes/sign-in';

type BootState =
  | { kind: 'loading' }
  | { kind: 'signedIn' }
  | { kind: 'signedOut' };

export const App = (): React.JSX.Element => {
  const [boot, setBoot] = useState<BootState>({ kind: 'loading' });
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void rpc.auth.currentSession().then((result) => {
      if (!alive) return;
      setBoot(result.ok && result.value ? { kind: 'signedIn' } : { kind: 'signedOut' });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = (event: Event): void => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      queryClient.clear();
      setAuthNotice(detail?.message ?? SESSION_EXPIRED_MESSAGE);
      setBoot({ kind: 'signedOut' });
      window.location.hash = '/sign-in';
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <Switch>
          <Route path="/sign-in">
            <SignInRoute
              notice={authNotice}
              onSignedIn={() => {
                setAuthNotice(null);
                setBoot({ kind: 'signedIn' });
              }}
            />
          </Route>
          <Route path="/">
            {boot.kind === 'loading' ? (
              <p className="px-6 py-16 text-[14px] text-neutral-500">Loading...</p>
            ) : boot.kind === 'signedIn' ? (
              <HomeRoute />
            ) : (
              <Redirect to="/sign-in" />
            )}
          </Route>
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </Router>
    </QueryClientProvider>
  );
};
