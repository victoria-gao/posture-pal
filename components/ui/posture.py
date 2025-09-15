import cv2
import mediapipe as mp
import math
from collections import deque

mp_drawing = mp.solutions.drawing_utils
mp_pose = mp.solutions.pose

cap = cv2.VideoCapture(0)

def angle_between(p1, p2, p3):
    # angle at p2 formed by p1-p2-p3
    v1 = (p1.x - p2.x, p1.y - p2.y)
    v2 = (p3.x - p2.x, p3.y - p2.y)
    dot = v1[0]*v2[0] + v1[1]*v2[1]
    mag1 = math.hypot(*v1)
    mag2 = math.hypot(*v2)
    return math.degrees(math.acos(dot / (mag1 * mag2)))

# Store baseline posture here after calibration
baseline = None

with mp_pose.Pose(
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7,
    model_complexity=1
) as pose:

    WINDOW_SIZE = 100
    REQUIRED_BAD = 80
    slouch_window = deque(maxlen=WINDOW_SIZE)
    side_window = deque(maxlen=WINDOW_SIZE)
    head_window = deque(maxlen=WINDOW_SIZE)

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(image_rgb)
        image = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)

        if results.pose_landmarks:
            lm = results.pose_landmarks.landmark

            nose = lm[mp_pose.PoseLandmark.NOSE.value]
            ear = lm[mp_pose.PoseLandmark.LEFT_EAR.value]
            right_shoulder = lm[mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
            left_shoulder = lm[mp_pose.PoseLandmark.LEFT_SHOULDER.value]
            left_hip = lm[mp_pose.PoseLandmark.LEFT_HIP.value]

            # Metrics for this frame
            head_forward = right_shoulder.x - ear.x
            head_side_slouch = abs(ear.z - left_hip.z)
            head_angle = angle_between(left_shoulder, ear, nose)

            # If user presses "c" → capture baseline posture
            key = cv2.waitKey(10) & 0xFF
            if key == ord('c'):
                baseline = {
                    "head_forward": head_forward,
                    "head_side_slouch": head_side_slouch,
                    "head_angle": head_angle
                }
                print("✅ Baseline posture captured:", baseline)

            if baseline:
                # Compare current frame to baseline with tolerance
                forward_diff = abs(head_forward - baseline["head_forward"])
                side_diff = abs(head_side_slouch - baseline["head_side_slouch"])
                angle_diff = abs(head_angle - baseline["head_angle"])
                print(f"Diffs - Forward: {forward_diff}, Side: {side_diff}, Angle: {angle_diff}")

                is_slouch = forward_diff > 0.01
                is_side_slouch = side_diff > 0.05
                is_head_lowered = angle_diff > 10

                slouch_window.append(1 if is_slouch else 0)
                side_window.append(1 if is_side_slouch else 0)
                head_window.append(1 if is_head_lowered else 0)

                if len(slouch_window) == WINDOW_SIZE and sum(slouch_window) >= REQUIRED_BAD:
                    cv2.putText(image, "Forward Slouch!", (50, 50),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
                if len(side_window) == WINDOW_SIZE and sum(side_window) >= REQUIRED_BAD:
                    cv2.putText(image, "Side Slouch!", (50, 90),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
                if len(head_window) == WINDOW_SIZE and sum(head_window) >= REQUIRED_BAD:
                    cv2.putText(image, "Head Lowered!", (50, 130),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
                if len(slouch_window):
                    print(f"Slouch window: {sum(slouch_window)}/{len(slouch_window)}")
                if len(side_window):
                    print(f"Side window: {sum(side_window)}/{len(side_window)}")
                if len(head_window):
                    print(f"Head window: {sum(head_window)}/{len(head_window)}")

            mp_drawing.draw_landmarks(image, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

        cv2.imshow("Posture Monitor", image)
        if cv2.waitKey(10) & 0xFF == ord('q'):
            break

cap.release()
cv2.destroyAllWindows()
