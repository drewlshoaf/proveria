'use client';

import {
  Container,
  Eyebrow,
  Header,
  LinkButton,
  MicroLabel,
} from '@proveria/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  api,
  type ApiError,
  type AttestationAccessGrant,
  type MeResponse,
} from '../lib/api';

export default function VerifierHomePage(): React.JSX.Element {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [grants, setGrants] = useState<AttestationAccessGrant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.me(), api.myAttestationAccess()])
      .then(([data, grantData]) => {
        if (!alive) return;
        setMe(data);
        setGrants(grantData.grants);
      })
      .catch((err: ApiError) => {
        if (!alive) return;
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        setError(
          'Could not load shared attestations. Refresh, or ask the producer to confirm your access grant is still active.',
        );
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } finally {
      router.replace('/login');
    }
  };

  return (
    <>
      <Header
        right={
          me ? (
            <>
              <span className="min-w-0 break-all text-[14px] text-neutral-500">
                {me.user.email}
              </span>
              <LinkButton onClick={logout}>Sign out</LinkButton>
            </>
          ) : null
        }
      />
      <Container className="py-12 sm:py-16">
        <Eyebrow>Verifier</Eyebrow>
        <h1 className="mt-2 text-[32px] font-medium leading-[1.15] tracking-[-0.02em]">
          Attestations shared with you
        </h1>
        <p className="mt-4 max-w-[720px] text-[18px] leading-[1.5] text-neutral-600 sm:text-[20px]">
          Open a shared attestation and verify a file, passage, image, or
          SHA-256. Proveria does not receive your files or pasted text.
        </p>

        {error ? (
          <p className="mt-12 text-[16px] text-neutral-600">{error}</p>
        ) : !me ? (
          <p className="mt-12 text-[14px] text-neutral-500">Loading...</p>
        ) : grants.length === 0 ? (
          <p className="mt-12 max-w-[720px] text-[14px] text-neutral-500">
            Nothing has been shared with this account yet. Ask the producer to
            grant this email access to an attestation and send you the private
            verifier lookup link. Revoked access no longer appears here.
          </p>
        ) : (
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {grants.map((grant) => (
              <a
                key={grant.grantId}
                href={`/lookups/${grant.attestation.id}`}
                className="block border border-[var(--color-border)] p-6 transition-colors duration-150 hover:border-neutral-700"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <h2 className="min-w-0 break-words text-[16px] font-medium">
                    {grant.attestation.label}
                  </h2>
                  <div className="shrink-0">
                    <MicroLabel>{grant.attestation.state}</MicroLabel>
                  </div>
                </div>
                <p className="mt-1 text-[14px] text-neutral-500">
                  {grant.tenant.name} · {grant.project.name}
                </p>
                {grant.attestation.confirmedAt && (
                  <p className="mt-3 text-[14px] text-neutral-700">
                    Confirmed{' '}
                    {new Date(grant.attestation.confirmedAt).toLocaleDateString()}
                  </p>
                )}
              </a>
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
