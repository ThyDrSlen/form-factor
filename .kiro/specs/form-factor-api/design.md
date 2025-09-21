# Design Document

## Overview

The Form Factor API is a RESTful service that provides comprehensive workout session management, exercise set logging, and AI-powered form analysis capabilities. The API follows OpenAPI 3.1.0 specification and implements a microservices architecture with clear separation of concerns between session management, exercise tracking, and form analysis services.

## Architecture

### API Structure
- **Base URL**: `https://api.formfactor.app/v1`
- **Protocol**: HTTPS only
- **Format**: JSON request/response bodies
- **Authentication**: Bearer token authentication
- **Versioning**: URL path versioning (v1)

### Core Services
1. **Session Service**: Manages workout session lifecycle
2. **Set Service**: Handles exercise set logging and tracking
3. **Form Analysis Service**: Processes video analysis and provides feedback
4. **Authentication Service**: Manages user authentication and authorization

## Components and Interfaces

### API Endpoints

#### Session Management
```
POST /sessions
- Creates new workout session
- Request: SessionCreate schema
- Response: 201 Created with Session schema
- Validates required startedAt timestamp
- Optional goal parameter (hypertrophy, strength, endurance)
```

#### Set Logging
```
POST /sets
- Logs individual exercise set
- Request: SetCreate schema  
- Response: 201 Created with Set schema`
- Requires sessionId, exerciseId, and reps
- Optional weight and video URL
```

#### Form Analysis
```
POST /form-analyses
- Initiates form analysis job
- Request: FormAnalysisCreate schema
- Response: 202 Accepted with FormAnalysisJob schema
- Requires setId, optional pose frames

GET /form-analyses/{jobId}
- Retrieves analysis status and results
- Path parameter: jobId (UUID)
- Response: 200 OK with FormAnalysisJob schema
- Returns status, cues, and metrics when complete
```

## Data Models

### Session Models
```typescript
interface SessionCreate {
  startedAt: string; // ISO 8601 datetime
  goal?: 'hypertrophy' | 'strength' | 'endurance';
}

interface Session extends SessionCreate {
  id: string; // UUID
  endedAt?: string; // ISO 8601 datetime
  status: 'active' | 'completed' | 'canceled';
}
```

### Set Models
```typescript
interface SetCreate {
  sessionId: string; // UUID
  exerciseId: string; // e.g., "pull_up_bw"
  reps: number; // minimum 1
  weightKg?: number;
  videoUrl?: string; // URI format
}

interface Set extends SetCreate {
  id: string; // UUID
  createdAt: string; // ISO 8601 datetime
}
```

### Form Analysis Models
```typescript
interface PoseKeypoint {
  name: string; // e.g., "left_elbow"
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  score: number; // confidence 0..1
}

interface PoseFrame {
  ts: number; // timestamp ms in video
  keypoints: PoseKeypoint[];
}

interface FormAnalysisCreate {
  setId: string; // UUID
  frames?: PoseFrame[]; // optional if server pulls video
}

interface Cue {
  ts: number; // timestamp in video
  level: 'info' | 'warn' | 'critical';
  message: string; // e.g., "Drive elbows down"
}

interface FormAnalysisJob {
  id: string; // UUID
  setId: string; // UUID
  status: 'queued' | 'processing' | 'done' | 'failed';
  cues?: Cue[];
  metrics?: Record<string, number>;
}
```

## Error Handling

### HTTP Status Codes
- **200 OK**: Successful GET requests
- **201 Created**: Successful POST requests creating resources
- **202 Accepted**: Asynchronous operations accepted
- **400 Bad Request**: Invalid request data or missing required fields
- **401 Unauthorized**: Authentication required or failed
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource not found
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server-side errors

### Error Response Format
```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}
```

### Validation Rules
- All UUIDs must be valid UUID v4 format
- Timestamps must be valid ISO 8601 format
- URLs must be valid URI format
- Numeric values must be within specified ranges
- Required fields must be present and non-null

## Testing Strategy

### Unit Tests
- Model validation and serialization
- Business logic for each service
- Error handling scenarios
- Authentication and authorization logic

### Integration Tests
- End-to-end API workflows
- Database integration
- External service integration (video processing)
- Authentication flow testing

### Performance Tests
- Load testing for high-volume set logging
- Stress testing for form analysis processing
- Rate limiting validation
- Database query optimization

### Security Tests
- Authentication bypass attempts
- Authorization boundary testing
- Input validation and sanitization
- SQL injection and XSS prevention

## Implementation Considerations

### Database Design
- Sessions table with user relationships
- Sets table with foreign keys to sessions and exercises
- Form analysis jobs table with status tracking
- Proper indexing for query performance

### Caching Strategy
- Session data caching for active workouts
- Exercise metadata caching
- Form analysis results caching
- Rate limiting cache for API throttling

### Scalability
- Horizontal scaling for API servers
- Queue-based processing for form analysis
- CDN for video content delivery
- Database read replicas for query scaling

### Monitoring and Observability
- API endpoint metrics and latency tracking
- Error rate monitoring and alerting
- Form analysis processing time metrics
- User activity and engagement analytics