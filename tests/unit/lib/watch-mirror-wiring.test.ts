import fs from 'fs';
import path from 'path';
import { readScanScreenSource } from '../../helpers/scan-screen-source';

const root = path.resolve(__dirname, '../../..');
const scan = readScanScreenSource();
const native = fs.readFileSync(path.join(root, 'modules/arkit-body-tracker/ios/ARKitBodyTrackerModule.swift'), 'utf8');

describe('Watch mirror native/screen integration contracts', () => {
  it('captures the display SVG and composites it with a viewport-cropped camera frame', () => {
    expect(scan).toContain('ref={watchMirrorSvgRef}');
    expect(scan).toContain('captureWatchMirrorOverlay(');
    expect(native).toContain('overlayImage.draw(in: bounds)');
    expect(native).toContain('"timestamp": frame.timestamp');
  });
  it('keeps preview updates running in rest/setup phases', () => {
    const timer = scan.slice(scan.indexOf('const tick = () => {', scan.indexOf('const captureAndSendWatchMirror')));
    expect(timer.slice(0, timer.indexOf('tick();'))).not.toContain('activePhaseRef.current === restPhaseRef.current');
  });
});
