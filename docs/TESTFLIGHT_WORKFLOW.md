# TestFlight & App Store Workflow

## Overview

This document outlines the build and release workflow for getting your app to users.

## Build Profiles

### 1. Development (Internal Only)
```bash
eas build --platform ios --profile development
```
- **Purpose**: Local development and debugging
- **Distribution**: Internal
- **Users**: Developers only
- **Use when**: Testing new features, debugging issues

### 2. Preview (Internal Only)
```bash
eas build --platform ios --profile preview
```
- **Purpose**: Quick previews without credentials
- **Distribution**: Internal (simulator builds)
- **Users**: Team members with simulators
- **Use when**: Reviewing UI changes, demos

### 3. Staging (TestFlight) - Start Here for Real Users
```bash
eas build --platform ios --profile staging --auto-submit
```
- **Purpose**: External beta testing
- **Distribution**: TestFlight via App Store Connect
- **Users**: Beta testers, early adopters (up to 10,000)
- **Environment**: Staging Supabase instance
- **Use when**: 
  - Ready for real user feedback
  - Testing before public launch
  - Validating new features with users
  - Collecting crash reports and analytics

### 4. Production (App Store)
```bash
eas build --platform ios --profile production --auto-submit
```
- **Purpose**: Public App Store release
- **Distribution**: App Store
- **Users**: General public
- **Environment**: Production Supabase instance
- **Use when**: 
  - TestFlight validation complete
  - Ready for public launch
  - Releasing updates to existing users

## Typical Release Process

### Phase 1: Initial Development
1. Build with `development` profile for local testing
2. Test features on device/simulator
3. Fix bugs and iterate quickly

### Phase 2: Beta Testing (First Real Users)
1. **Build staging**: `eas build --platform ios --profile staging --auto-submit`
2. **Wait for TestFlight**: Build appears in App Store Connect (~15-20 min build + 5-10 min processing)
3. **Create test group**: In App Store Connect > TestFlight > External Testing
4. **Invite testers**: Share TestFlight link or public link
5. **Collect feedback**: Monitor crash reports, TestFlight feedback, analytics
6. **Iterate**: Fix issues and push new staging builds
7. **Repeat** until app is stable and ready

### Phase 3: Production Release
1. **Final staging validation**: Ensure all critical issues resolved
2. **Build production**: `eas build --platform ios --profile production --auto-submit`
3. **Submit for review**: In App Store Connect, submit for App Review
4. **Wait for approval**: Apple reviews (1-3 days typically)
5. **Release**: Manually release or auto-release when approved

## TestFlight User Journey

### For Beta Testers (Staging)

1. **Receive invite**: Email or public link
2. **Install TestFlight app**: Download from App Store if needed
3. **Accept invite**: Tap "Start Testing" 
4. **Install your app**: Download from TestFlight
5. **Test and provide feedback**: Use the app, report issues
6. **Get updates**: Automatic notifications for new builds

### Setting Up TestFlight

#### In App Store Connect:
1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. Navigate to your app (create one if it doesn't exist)
3. Go to **TestFlight** tab
4. Create **External Testing** group
5. Add testers by email or create a **Public Link**

#### Public Link (Easiest for many testers):
- No need to add individual emails
- Share a single URL
- Anyone with link can join (up to 10,000)
- Great for beta signups on your website/social media

## Environment Setup

### Required EAS Secrets

Set these at [expo.dev](https://expo.dev/accounts/slenthekid/projects/form-factor-eas/secrets):

```bash
# For staging (TestFlight)
eas secret:create --scope project --name SUPABASE_STAGING_URL --value "https://your-staging-project.supabase.co"
eas secret:create --scope project --name SUPABASE_STAGING_ANON_KEY --value "your-staging-anon-key"

# For production (App Store)
eas secret:create --scope project --name SUPABASE_PRODUCTION_URL --value "https://your-prod-project.supabase.co"
eas secret:create --scope project --name SUPABASE_PRODUCTION_ANON_KEY --value "your-prod-anon-key"

# Apple Team ID (required for both)
eas secret:create --scope project --name APPLE_TEAM_ID --value "YOUR_TEAM_ID"
```

Find your Apple Team ID: [developer.apple.com/account](https://developer.apple.com/account)

## Quick Commands

```bash
# Check EAS login
eas whoami

# Configure iOS credentials (first time)
eas credentials

# Build and submit to TestFlight (most common)
eas build --platform ios --profile staging --auto-submit

# Build and submit to App Store
eas build --platform ios --profile production --auto-submit

# View build status
eas build:list

# View submitted builds
eas submit:list
```

## Best Practices

### For Staging/TestFlight
- Test with 10-50 users initially, then scale up
- Use staging Supabase to avoid affecting production data
- Push frequent updates (daily/weekly) during beta
- Monitor TestFlight crash reports in App Store Connect
- Request feedback from testers regularly
- Keep beta period to 2-4 weeks for focused testing

### For Production
- Only release after thorough staging validation
- Use production Supabase with proper backups
- Test app review criteria compliance
- Prepare App Store screenshots and descriptions
- Have support contact ready for users
- Monitor production analytics closely after launch

## Troubleshooting

### Build fails
- Check `eas build:list` for error logs
- Verify all secrets are set correctly
- Ensure Apple Developer account is active

### TestFlight submission fails
- Verify `APPLE_TEAM_ID` is correct
- Check App Store Connect for app listing
- Ensure bundle ID matches: `com.slenthekid.form-factor-eas`

### Users can't install from TestFlight
- Check if build is "Ready to Submit" in App Store Connect
- Verify TestFlight external testing is enabled
- Ensure build passed Apple's automated review (~5-10 min)

## Resources

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [TestFlight Documentation](https://developer.apple.com/testflight/)
- [App Store Connect](https://appstoreconnect.apple.com)

