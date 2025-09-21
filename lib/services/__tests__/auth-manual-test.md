# Manual Auth Testing Guide

## Test Scenarios

### 1. Session Persistence Test
**Objective**: Verify that user sessions persist across app restarts

**Steps**:
1. Open the app (should show sign-in screen)
2. Sign in with Google OAuth
3. Verify you're redirected to the home screen with tabs
4. Close the app completely
5. Reopen the app
6. **Expected**: Should automatically show the authenticated home screen without requiring sign-in

**Pass Criteria**: ✅ User remains signed in after app restart

---

### 2. OAuth Flow Test
**Objective**: Verify Google OAuth works correctly

**Steps**:
1. Open the app
2. Tap "Sign in with Google"
3. Complete OAuth flow in browser
4. **Expected**: Redirected back to app and signed in

**Pass Criteria**: ✅ OAuth completes successfully and user is authenticated

---

### 3. Sign Out Test
**Objective**: Verify sign out clears session properly

**Steps**:
1. While signed in, go to Profile tab
2. Tap "Sign Out"
3. **Expected**: Redirected to sign-in screen
4. Close and reopen app
5. **Expected**: Should show sign-in screen (not auto-login)

**Pass Criteria**: ✅ Sign out clears session and prevents auto-login

---

### 4. Display Name Test
**Objective**: Verify users can set custom display names

**Steps**:
1. Sign in and go to Profile tab
2. Tap the edit icon next to your name
3. Enter a custom display name
4. Tap "Save"
5. **Expected**: Name updates in profile and home screen
6. Close and reopen app
7. **Expected**: Custom name persists

**Pass Criteria**: ✅ Custom display name saves and persists

---

### 5. Routing Test
**Objective**: Verify proper routing based on auth state

**Steps**:
1. When not signed in, try to access `/` directly
2. **Expected**: Should redirect to `/sign-in`
3. When signed in, try to access `/sign-in` directly
4. **Expected**: Should redirect to tabs home

**Pass Criteria**: ✅ Routing correctly handles auth state

---

## Test Results Log

| Test | Date | Result | Notes |
|------|------|--------|-------|
| Session Persistence | | ⏳ | |
| OAuth Flow | | ⏳ | |
| Sign Out | | ⏳ | |
| Display Name | | ⏳ | |
| Routing | | ⏳ | |

## Common Issues & Solutions

### Issue: Session not persisting
- **Check**: SessionManager logs in console
- **Solution**: Verify AsyncStorage is working on native platforms

### Issue: OAuth callback fails
- **Check**: Callback URL configuration in Supabase
- **Solution**: Ensure redirect URL matches app configuration

### Issue: Display name not updating
- **Check**: Supabase user metadata update logs
- **Solution**: Verify user has permission to update profile

## Debugging Tips

1. **Enable detailed logging**: Check console for `[Auth]`, `[SessionManager]`, and `[OAuthHandler]` logs
2. **Check Supabase dashboard**: Verify user data and auth events
3. **Test on different platforms**: Behavior may differ between web and native
4. **Clear app data**: If testing gets inconsistent, clear app storage/cache