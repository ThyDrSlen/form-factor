# Technology Stack

## Framework & Platform
- **Expo SDK 53** with React Native 0.79.5 and React 19.0.0
- **Expo Router 5.1** for file-based navigation with typed routes
- **Hermes JS Engine** for optimized performance
- **New Architecture** enabled for future React Native features

## Backend & Database
- **Supabase** for authentication, database, realtime, and storage
- **PostgreSQL** with Row Level Security (RLS) policies
- **Supabase Edge Functions** for serverless API endpoints
- **Supabase Realtime** for live feed updates

## Key Libraries
- **UI**: React Native Paper, Expo Symbols, Moti (animations)
- **Navigation**: React Navigation with bottom tabs
- **Camera/ML**: react-native-vision-camera, MediaPipe WASM, OpenCV.js
- **Auth**: Expo Apple Authentication, Supabase Auth
- **Storage**: AsyncStorage for local data persistence
- **Media**: Expo AV, Expo Image, Expo Media Library

## Build System & Deployment
- **EAS Build** with multiple profiles (development, preview, staging, production)
- **Metro bundler** with custom resolver for tslib compatibility
- **TypeScript** with strict mode enabled
- **Babel** with module resolver for @ alias paths

## Development Commands

### Local Development
```bash
npm start                    # Start Expo dev server
npm run ios                  # Run on iOS simulator  
npm run ios:fc              # Run on specific device "fc"
npm run web                  # Start web development server
npm run start:devclient     # Start with development client
```

### Building & Deployment
```bash
eas build --profile preview     # Create preview build
eas build --profile production  # Create production build
eas submit --profile production # Submit to app stores
eas update --branch production  # Push OTA update
```

### Database Operations
```bash
supabase start              # Start local Supabase stack
supabase db push            # Deploy migrations to remote
supabase gen types typescript # Generate TypeScript types
supabase db reset           # Reset local database
```

### Testing & Quality
```bash
npm run lint                # Run ESLint
npx tsc --noEmit           # TypeScript type checking
npm test                   # Run unit tests (when configured)
```

### Utility Commands
```bash
npm run kill               # Kill development servers on ports 8081-8085
npm run reset-project      # Reset project to clean state
```

## Environment Configuration
- **Development**: Local Supabase instance on localhost:54321
- **Staging**: Staging Supabase project with internal distribution
- **Production**: Production Supabase project with app store distribution

## Code Style & Conventions
- **TypeScript strict mode** with path aliases (@/*)
- **ESLint** with Expo configuration
- **Module resolution** via Babel plugin for clean imports
- **Hermes** on Android, **JSC** on iOS for optimal performance