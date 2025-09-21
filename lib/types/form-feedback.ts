/**
 * Core types for real-time form feedback system
 */

export interface PosePoint {
  x: number;
  y: number;
  confidence: number;
}

export interface PoseKeypoints {
  nose: PosePoint;
  leftEye: PosePoint;
  rightEye: PosePoint;
  leftEar: PosePoint;
  rightEar: PosePoint;
  leftShoulder: PosePoint;
  rightShoulder: PosePoint;
  leftElbow: PosePoint;
  rightElbow: PosePoint;
  leftWrist: PosePoint;
  rightWrist: PosePoint;
  leftHip: PosePoint;
  rightHip: PosePoint;
  leftKnee: PosePoint;
  rightKnee: PosePoint;
  leftAnkle: PosePoint;
  rightAnkle: PosePoint;
}

export interface FormAnalysis {
  overallScore: number; // 0-100
  jointAngles: Record<string, number>;
  feedback: FormFeedback[];
  timestamp: number;
  repCount?: number;
}

export interface FormFeedback {
  type: 'good' | 'warning' | 'error';
  joint: string;
  message: string;
  severity: number; // 1-10
  audioMessage?: string;
}

export interface WorkoutSession {
  id: string;
  userId: string;
  exercise: string;
  startTime: number;
  endTime?: number;
  repCount: number;
  formScores: FormAnalysis[];
  averageScore: number;
  calibrationData?: CalibrationData;
  deviceInfo: DeviceInfo;
}

export interface CalibrationData {
  cameraDistance: number;
  cameraAngle: number;
  userHeight?: number;
  baselineAngles: Record<string, number>;
  timestamp: number;
  isValid: boolean;
}

export interface DeviceInfo {
  platform: string;
  cameraPosition: 'front' | 'back';
  screenDimensions: { width: number; height: number };
  deviceModel?: string;
}

export interface ExerciseConfig {
  name: string;
  displayName: string;
  description: string;
  keyJoints: string[];
  idealAngles: Record<string, AngleRange>;
  commonMistakes: FormMistake[];
  calibrationPoints: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  category: 'strength' | 'cardio' | 'flexibility' | 'balance';
}

export interface AngleRange {
  min: number;
  max: number;
  optimal: number;
  tolerance: number; // degrees of acceptable deviation
}

export interface FormMistake {
  id: string;
  condition: (angles: Record<string, number>) => boolean;
  message: string;
  severity: number;
  audioFeedback: string;
  correctionTip: string;
}

export interface CameraSettings {
  position: 'front' | 'back';
  resolution: 'low' | 'medium' | 'high';
  frameRate: number;
  enableAudio: boolean;
}

export interface FeedbackSettings {
  visualEnabled: boolean;
  audioEnabled: boolean;
  audioVolume: number; // 0-1
  feedbackSensitivity: 'low' | 'medium' | 'high';
  language: string;
  colorBlindMode: boolean;
}

export interface SessionStats {
  totalSessions: number;
  totalReps: number;
  averageScore: number;
  bestScore: number;
  improvementTrend: number; // percentage change
  lastSessionDate: number;
  streakDays: number;
}

// Event types for real-time feedback
export interface FormFeedbackEvent {
  type: 'pose_detected' | 'form_analyzed' | 'rep_completed' | 'session_started' | 'session_ended';
  data: any;
  timestamp: number;
}

// Camera frame processing
export interface FrameData {
  width: number;
  height: number;
  data: ArrayBuffer;
  timestamp: number;
  orientation: 'portrait' | 'landscape';
}

// ML Model configuration
export interface ModelConfig {
  modelType: 'mediapipe' | 'tensorflow' | 'custom';
  modelPath?: string;
  confidenceThreshold: number;
  maxDetections: number;
  enableSmoothing: boolean;
}

// Error types
export type FormFeedbackError = 
  | 'camera_permission_denied'
  | 'camera_not_available'
  | 'pose_detection_failed'
  | 'calibration_required'
  | 'low_confidence'
  | 'device_not_supported'
  | 'network_error'
  | 'storage_error';

export interface FormFeedbackErrorInfo {
  type: FormFeedbackError;
  message: string;
  recoverable: boolean;
  retryAction?: () => void;
}