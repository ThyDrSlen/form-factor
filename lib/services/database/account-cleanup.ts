import AsyncStorage from '@react-native-async-storage/async-storage';

export const ACCOUNT_CLEANUP_KEY = '@formfactor/account-cleanup-pending';
const BLOCKED_MESSAGE = 'Account cleanup is pending. Retry signing in or signing out before syncing.';
const LOGOUT_PREFIX = 'logout:';

export interface AccountCleanupOptions {
  logoutOwner?: string;
  // Only confirmed SDK sign-out or cleaned replacement identity resolves this.
  resolveLogout?: boolean;
}

/** A cleanup obligation, not proof of row ownership. Shared by auth and sync. */
export class AccountCleanupBarrier {
  private blocked = false;
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();

  get generation(): number { return this.revision; }
  get isBlocked(): boolean { return this.blocked; }

  // Safe inside the SDK callback: no awaited auth/storage work under its lock.
  block(): void {
    this.blocked = true;
    this.revision += 1;
  }

  async isPending(): Promise<boolean> {
    if (this.blocked) return true;
    try {
      // Any persisted value means unfinished cleanup, including corrupt markers.
      if (await AsyncStorage.getItem(ACCOUNT_CLEANUP_KEY) !== null) this.block();
      return this.blocked;
    } catch (error) {
      this.block();
      throw error;
    }
  }

  async assertReady(): Promise<void> {
    if (await this.isPending()) throw new Error(BLOCKED_MESSAGE);
  }

  async getPendingLogoutOwner(): Promise<string | null> {
    try {
      const value = await AsyncStorage.getItem(ACCOUNT_CLEANUP_KEY);
      return value?.startsWith(LOGOUT_PREFIX) ? value.slice(LOGOUT_PREFIX.length) || '*' : null;
    } catch (error) {
      this.block();
      throw error;
    }
  }

  run(cleanup: () => Promise<void>, options: AccountCleanupOptions = {}): Promise<void> {
    this.block();
    const revision = this.revision;
    const operation = this.tail.then(async () => {
      const logoutOwner = options.logoutOwner ?? await this.getPendingLogoutOwner();
      const marker = logoutOwner ? `${LOGOUT_PREFIX}${logoutOwner}` : '1';
      // Persist before changing data or credentials. Failure keeps access closed.
      await AsyncStorage.setItem(ACCOUNT_CLEANUP_KEY, marker);
      await cleanup();
      if (logoutOwner && !options.resolveLogout) return;
      if (revision !== this.revision) return;
      await AsyncStorage.removeItem(ACCOUNT_CLEANUP_KEY);
      if (revision === this.revision) {
        this.blocked = false;
      } else {
        // A new SDK transition can arrive while removal is in flight, before
        // its deferred cleanup starts. Restore its durable retry obligation.
        await AsyncStorage.setItem(ACCOUNT_CLEANUP_KEY, marker);
      }
    });
    // One failed attempt must not poison subsequent retries.
    this.tail = operation.catch(() => {});
    return operation;
  }
}

export const accountCleanup = new AccountCleanupBarrier();
