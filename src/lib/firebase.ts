/**
 * Firebase Firestore — reliability fallback for Supabase free-tier cold starts.
 *
 * Architecture:
 *  - Supabase is the primary database and source of truth.
 *  - Firestore is a read-mirror. Critical reads (panel fetch, key validation)
 *    fall back to Firestore when Supabase times out or returns an error.
 *  - Writes always go to Supabase first. Successful writes are mirrored to
 *    Firestore so the read-mirror stays current.
 *
 * Collections mirrored to Firestore:
 *  - managed_panels/{panel.id}
 *  - api_keys/{key.id}
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  DocumentData,
} from 'firebase/firestore';
import type { ManagedPanel, ApiKey } from './supabase';

const firebaseConfig = {
  apiKey: 'AIzaSyB9bZm_ATPF8mNyN6GU4njQwhy4LzIdEZA',
  authDomain: 'cfms-d9142.firebaseapp.com',
  projectId: 'cfms-d9142',
  storageBucket: 'cfms-d9142.firebasestorage.app',
  messagingSenderId: '185141817679',
  appId: '1:185141817679:web:8f51456ebe624c13e0553a',
  measurementId: 'G-WX098D0RD7',
};

// Safe init — handles HMR hot-reloads without duplicate-app errors.
const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);

// ── Read helpers (used as Supabase fallbacks) ─────────────────────────────────

/** Fetch a panel by slug. Returns null if not found or Firestore is unreachable. */
export async function fbGetPanelBySlug(slug: string): Promise<ManagedPanel | null> {
  try {
    const q = query(
      collection(db, 'managed_panels'),
      where('slug', '==', slug.toLowerCase())
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data() as ManagedPanel;
  } catch {
    return null;
  }
}

/** Validate an access key. Returns the key row or null if invalid/expired/not found. */
export async function fbValidateKey(
  keyValue: string
): Promise<{ key_value: string; name: string; id: string } | null> {
  try {
    const q = query(
      collection(db, 'api_keys'),
      where('key_value', '==', keyValue),
      where('is_active', '==', true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const row = snap.docs[0].data() as ApiKey;
    // Reject expired keys
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return { key_value: row.key_value, name: row.name, id: row.id };
  } catch {
    return null;
  }
}

/** Fetch all panels. Used as MasterPanel fallback when Supabase is unreachable. */
export async function fbGetAllPanels(): Promise<ManagedPanel[]> {
  try {
    const snap = await getDocs(collection(db, 'managed_panels'));
    return snap.docs.map(d => d.data() as ManagedPanel);
  } catch {
    return [];
  }
}

/** Fetch all API keys for a specific panel. Primary fast read path. */
export async function fbListKeysByPanel(panelId: string): Promise<ApiKey[]> {
  try {
    const q = query(collection(db, 'api_keys'), where('panel_id', '==', panelId));
    const snap = await getDocs(q);
    return snap.docs
      .map(d => d.data() as ApiKey)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch {
    return [];
  }
}

/** Fetch all API keys (global / admin view). Primary fast read path. */
export async function fbListAllKeys(): Promise<ApiKey[]> {
  try {
    const snap = await getDocs(collection(db, 'api_keys'));
    return snap.docs
      .map(d => d.data() as ApiKey)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch {
    return [];
  }
}

// ── Write helpers (mirror Supabase writes to keep Firestore current) ──────────
// These are all fire-and-forget — they never throw, so a Firestore failure
// never blocks or rolls back the Supabase write.

/** Upsert a full panel document. Call after panel create. */
export async function fbUpsertPanel(panel: ManagedPanel): Promise<void> {
  try {
    await setDoc(doc(db, 'managed_panels', panel.id), panel as unknown as DocumentData);
  } catch { /* non-fatal */ }
}

/** Partial update of a panel document. Call after panel update. */
export async function fbUpdatePanel(id: string, fields: Partial<ManagedPanel>): Promise<void> {
  try {
    await updateDoc(doc(db, 'managed_panels', id), fields as DocumentData);
  } catch { /* non-fatal */ }
}

/** Delete a panel document. Call after panel delete. */
export async function fbDeletePanel(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'managed_panels', id));
  } catch { /* non-fatal */ }
}

/** Upsert a full API key document. Call after key create. */
export async function fbUpsertKey(key: ApiKey): Promise<void> {
  try {
    await setDoc(doc(db, 'api_keys', key.id), key as unknown as DocumentData);
  } catch { /* non-fatal */ }
}

/** Partial update of an API key document. Call after key toggle. */
export async function fbUpdateKey(id: string, fields: Partial<ApiKey>): Promise<void> {
  try {
    await updateDoc(doc(db, 'api_keys', id), fields as DocumentData);
  } catch { /* non-fatal */ }
}

/** Delete an API key document. Call after key delete. */
export async function fbDeleteKey(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'api_keys', id));
  } catch { /* non-fatal */ }
}
