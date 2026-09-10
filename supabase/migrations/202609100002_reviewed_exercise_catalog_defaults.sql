-- Reviewed registry: supabase/exercise-defaults/2026-09-10.json.
-- All 84 approved identities are Catalyst imports whose UUIDs differ between
-- databases. Resolve their exact unique source identity, never a name pattern.
-- Audited UUIDs remain provenance, not a portability assumption. Expected name,
-- source URL, mode and fields guard against an unrelated or subsequently edited
-- catalog entry. Existing workout/session snapshots and personal exercises are
-- never rewritten; the ten explicitly deferred proposals remain unchanged.
create temporary table reviewed_exercise_defaults (
  audited_id uuid not null,
  source_provider text not null,
  source_external_id text not null,
  source_url text not null,
  name text not null,
  expected_mode text not null,
  expected_fields text[] not null,
  recommended_mode text not null,
  recommended_fields text[] not null,
  primary key (source_provider, source_external_id)
) on commit drop;

insert into reviewed_exercise_defaults values
  ('0b6bb4fc-fc66-4f32-81f2-92505c800a7f'::uuid, 'catalyst-athletics', '371', 'https://www.catalystathletics.com/exercise/371/Dip-Clean/', 'Dip Clean', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('7e509682-acc2-420c-9382-b4575a4c116f'::uuid, 'catalyst-athletics', '660', 'https://www.catalystathletics.com/exercise/660/Dip-Clean-Pull/', 'Dip Clean Pull', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('d4d82de2-ce48-4a38-9493-dda715116800'::uuid, 'catalyst-athletics', '662', 'https://www.catalystathletics.com/exercise/662/Dip-Muscle-Clean/', 'Dip Muscle Clean', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('c869f494-e694-4156-a05a-2ddce2d29ef4'::uuid, 'catalyst-athletics', '464', 'https://www.catalystathletics.com/exercise/464/Dip-Muscle-Snatch/', 'Dip Muscle Snatch', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('8e555020-a89c-4764-8725-1143229f3822'::uuid, 'catalyst-athletics', '643', 'https://www.catalystathletics.com/exercise/643/Dip-Power-Clean/', 'Dip Power Clean', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('9625b48d-0dfc-45a2-9b3d-f0d009a7a051'::uuid, 'catalyst-athletics', '449', 'https://www.catalystathletics.com/exercise/449/Dip-Power-Snatch/', 'Dip Power Snatch', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('f725f904-eac1-4c8e-8d47-e355fa2e4ea1'::uuid, 'catalyst-athletics', '401', 'https://www.catalystathletics.com/exercise/401/Dip-Snatch/', 'Dip Snatch', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('0786bd34-b92d-4f91-af56-e0eb47ed09a9'::uuid, 'catalyst-athletics', '661', 'https://www.catalystathletics.com/exercise/661/Dip-Snatch-Pull/', 'Dip Snatch Pull', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('3f2ee3d5-f021-4ed6-b20a-ca5cfb11d180'::uuid, 'catalyst-athletics', '684', 'https://www.catalystathletics.com/exercise/684/Block-Clean-Pull-To-Hold/', 'Block Clean Pull To Hold', 'result', array['duration', 'load', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('1123e348-e51c-4475-b505-8aa767f181e7'::uuid, 'catalyst-athletics', '672', 'https://www.catalystathletics.com/exercise/672/Block-Snatch-Pull-To-Hold/', 'Block Snatch Pull To Hold', 'result', array['duration', 'load', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('e6b5f203-bcdb-4b53-80ba-6f7cd5270517'::uuid, 'catalyst-athletics', '450', 'https://www.catalystathletics.com/exercise/450/Clean-Pull-To-Hold/', 'Clean Pull To Hold', 'result', array['duration', 'load', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('67b0e361-07ac-4506-91ae-7339e025b865'::uuid, 'catalyst-athletics', '454', 'https://www.catalystathletics.com/exercise/454/Flat-Footed-Clean-Pull-To-Hold/', 'Flat-Footed Clean Pull To Hold', 'result', array['duration', 'load', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('3ff243fe-492b-4b4a-9892-6193fdaf5aee'::uuid, 'catalyst-athletics', '457', 'https://www.catalystathletics.com/exercise/457/Flat-Footed-Snatch-Pull-To-Hold/', 'Flat-Footed Snatch Pull To Hold', 'result', array['duration', 'load', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('727c8d5e-cfd0-4c52-9462-b6ff59825ef1'::uuid, 'catalyst-athletics', '453', 'https://www.catalystathletics.com/exercise/453/Snatch-Pull-To-Hold/', 'Snatch Pull To Hold', 'result', array['duration', 'load', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('4e9ca67b-27de-484d-8001-2dc1a41406c3'::uuid, 'catalyst-athletics', '353', 'https://www.catalystathletics.com/exercise/353/Back-Squat-Jump/', 'Back Squat Jump', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('f3ed3ed7-e8f5-4cee-9a16-f7cccc4f6f65'::uuid, 'catalyst-athletics', '104', 'https://www.catalystathletics.com/exercise/104/Concentric-Quarter-Squat-Jump/', 'Concentric Quarter Squat Jump', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('f6e0728f-98b5-45d7-b093-76c13a9a9ac9'::uuid, 'catalyst-athletics', '620', 'https://www.catalystathletics.com/exercise/620/Pause-Back-Squat-Jump/', 'Pause Back Squat Jump', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('faeaf802-0a7f-4d76-bc20-5d9a16e52953'::uuid, 'catalyst-athletics', '621', 'https://www.catalystathletics.com/exercise/621/Pause-Quarter-Back-Squat-Jump/', 'Pause Quarter Back Squat Jump', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('47260d34-56b6-4669-9682-6ed5bcb74510'::uuid, 'catalyst-athletics', '426', 'https://www.catalystathletics.com/exercise/426/Quarter-Back-Squat-Jump/', 'Quarter Back Squat Jump', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('5da840c6-0d83-4898-948f-bcd0d06e4cde'::uuid, 'catalyst-athletics', '181', 'https://www.catalystathletics.com/exercise/181/Clean-Rack-Support/', 'Clean Rack Support', 'sets', array['reps', 'load', 'rpe']::text[], 'result', array['duration', 'load', 'rpe']::text[]),
  ('e8b10d6c-7ef7-49a7-a672-e90ca8aca60d'::uuid, 'catalyst-athletics', '196', 'https://www.catalystathletics.com/exercise/196/Jerk-Rack-Support/', 'Jerk Rack Support', 'sets', array['reps', 'load', 'rpe']::text[], 'result', array['duration', 'load', 'rpe']::text[]),
  ('ce7ea73a-3341-4759-b5e7-5401c2fdf344'::uuid, 'catalyst-athletics', '787', 'https://www.catalystathletics.com/exercise/787/Sledgehammer-Wrist-Rotation/', 'Sledgehammer Wrist Rotation', 'result', array['distance', 'load', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('501a68a0-3747-408e-adbc-de0267602d02'::uuid, 'catalyst-athletics', '566', 'https://www.catalystathletics.com/exercise/566/Copenhagen-Plank-Lift/', 'Copenhagen Plank Lift', 'result', array['duration']::text[], 'sets', array['reps']::text[]),
  ('9509a7b7-4d8e-458a-83a4-fb249ae65ff2'::uuid, 'catalyst-athletics', '775', 'https://www.catalystathletics.com/exercise/775/Side-Plank-Clamshell/', 'Side Plank Clamshell', 'result', array['duration']::text[], 'sets', array['reps']::text[]),
  ('a826a25c-3eab-4276-a7c3-d4eb860b9ea1'::uuid, 'catalyst-athletics', '499', 'https://www.catalystathletics.com/exercise/499/Side-Plank-Lift/', 'Side Plank Lift', 'result', array['duration', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('ceb9c327-d6a2-446b-a0e6-cffff5af5746'::uuid, 'catalyst-athletics', '781', 'https://www.catalystathletics.com/exercise/781/Supine-Banded-Plank-March/', 'Supine Banded Plank March', 'result', array['duration']::text[], 'sets', array['reps']::text[]),
  ('568d3c00-fcc2-4902-b73e-d8561f4dbd6e'::uuid, 'catalyst-athletics', '528', 'https://www.catalystathletics.com/exercise/528/Plank-Pull-Through/', 'Plank Pull-Through', 'result', array['duration', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('bdc00ca7-0939-4df0-866f-daa8732aea57'::uuid, 'catalyst-athletics', '586', 'https://www.catalystathletics.com/exercise/586/Side-Plank-External-Rotation/', 'Side Plank External Rotation', 'result', array['duration', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('5c851cf2-32a1-4b64-a427-6d4ff57ef4d6'::uuid, 'catalyst-athletics', '506', 'https://www.catalystathletics.com/exercise/506/Back-Extension-Hold-Rotations/', 'Back Extension Hold Rotations', 'result', array['duration', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('a9f3208d-a298-4eba-a20b-04b625cb6bcd'::uuid, 'catalyst-athletics', '504', 'https://www.catalystathletics.com/exercise/504/Anti-Rotation-Landmine/', 'Anti-Rotation Landmine', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('44727f50-1ad9-48b3-9af6-be4e7ea7d57b'::uuid, 'catalyst-athletics', '503', 'https://www.catalystathletics.com/exercise/503/Anti-Rotation-Russian-Twist/', 'Anti-Rotation Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('7de47fb8-18df-43c5-aad2-7019b9489a11'::uuid, 'catalyst-athletics', '701', 'https://www.catalystathletics.com/exercise/701/Barbell-Side-Bend/', 'Barbell Side Bend', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('afadc519-f6c0-4bfe-ae97-304e32fceea9'::uuid, 'catalyst-athletics', '158', 'https://www.catalystathletics.com/exercise/158/Cross-Chop/', 'Cross Chop', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('795e1423-b374-4868-9326-f336d59e9b35'::uuid, 'catalyst-athletics', '508', 'https://www.catalystathletics.com/exercise/508/Death-March/', 'Death March', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('0b141aac-5d80-4dac-839d-e6e4c0812d07'::uuid, 'catalyst-athletics', '703', 'https://www.catalystathletics.com/exercise/703/Decline-Anti-Rotation-Russian-Twist/', 'Decline Anti-Rotation Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('5ac7b0ab-cbad-4a80-8106-049dbec19f94'::uuid, 'catalyst-athletics', '705', 'https://www.catalystathletics.com/exercise/705/Decline-Russian-Twist/', 'Decline Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('d1dc822a-a22c-4588-b6e2-9bcafa8c6045'::uuid, 'catalyst-athletics', '510', 'https://www.catalystathletics.com/exercise/510/Full-Moon/', 'Full Moon', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('141fd9ec-2019-4881-9078-c867d5fc343b'::uuid, 'catalyst-athletics', '634', 'https://www.catalystathletics.com/exercise/634/GHD-Anti-Rotation-Russian-Twist/', 'GHD Anti-Rotation Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('4715e241-b6e5-41e4-8142-c8ea0ecb843d'::uuid, 'catalyst-athletics', '707', 'https://www.catalystathletics.com/exercise/707/GHD-Russian-Twist/', 'GHD Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('4c41b95c-011d-4474-a573-3aa7c4cc32d3'::uuid, 'catalyst-athletics', '708', 'https://www.catalystathletics.com/exercise/708/GHD-Sit-up-Anti-Rotation-Russian-Twist/', 'GHD Sit-up + Anti-Rotation Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('8be02c5c-0f3e-4983-89f0-a7d100f0851c'::uuid, 'catalyst-athletics', '593', 'https://www.catalystathletics.com/exercise/593/GHD-Sit-up-Russian-Twist/', 'GHD Sit-up + Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('0c75729f-7e05-4e41-a097-4d9d1c6b6f05'::uuid, 'catalyst-athletics', '709', 'https://www.catalystathletics.com/exercise/709/Half-Kneeling-Cross-Chop/', 'Half-Kneeling Cross Chop', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('3b45379a-eb7a-447a-a0fe-525ead440b45'::uuid, 'catalyst-athletics', '511', 'https://www.catalystathletics.com/exercise/511/Halfmoon/', 'Halfmoon', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('eaa02a6b-fc79-44e9-ab4a-072509b57c7f'::uuid, 'catalyst-athletics', '711', 'https://www.catalystathletics.com/exercise/711/Hip-Extension-Row/', 'Hip Extension Row', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('bcc54450-9309-45d6-a010-6aa68e1b218c'::uuid, 'catalyst-athletics', '521', 'https://www.catalystathletics.com/exercise/521/Jefferson-Curl/', 'Jefferson Curl', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('66ad664b-5278-4c51-bcff-8971956f1a5c'::uuid, 'catalyst-athletics', '523', 'https://www.catalystathletics.com/exercise/523/Low-Windmill/', 'Low Windmill', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('cada9b75-8682-4c3f-a1de-5c0e7453a66b'::uuid, 'catalyst-athletics', '489', 'https://www.catalystathletics.com/exercise/489/Russian-Twist/', 'Russian Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('6874cf43-5326-4fbd-94c7-71769b982bf6'::uuid, 'catalyst-athletics', '497', 'https://www.catalystathletics.com/exercise/497/Side-Bend/', 'Side Bend', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('bb7a98b4-07e9-439b-9c13-303dd054c228'::uuid, 'catalyst-athletics', '718', 'https://www.catalystathletics.com/exercise/718/Single-Arm-Bench-Press-In-Hollow-/', 'Single-Arm Bench Press In Hollow', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('53d65a07-c4fe-4120-838c-59d0d4c78bbc'::uuid, 'catalyst-athletics', '314', 'https://www.catalystathletics.com/exercise/314/Standing-Plate-Twist/', 'Standing Plate Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('53dd6cb2-9ad0-42c2-96ba-2369ca429b96'::uuid, 'catalyst-athletics', '512', 'https://www.catalystathletics.com/exercise/512/Topside-Halfmoon/', 'Topside Halfmoon', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('af31c0da-ed5a-4110-8abe-aaff875a346a'::uuid, 'catalyst-athletics', '522', 'https://www.catalystathletics.com/exercise/522/Windmill/', 'Windmill', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('cf243a85-4748-4d1a-a18c-6a3a560860fd'::uuid, 'catalyst-athletics', '720', 'https://www.catalystathletics.com/exercise/720/Standing-Barbell-Twist/', 'Standing Barbell Twist', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('23721c83-bd94-4bc9-87ae-b3ed66645efc'::uuid, 'catalyst-athletics', '507', 'https://www.catalystathletics.com/exercise/507/Basketball-Abs/', 'Basketball Abs', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('c34431d8-d19a-426e-a94a-463bd30621ae'::uuid, 'catalyst-athletics', '713', 'https://www.catalystathletics.com/exercise/713/Overhead-Basketball-Abs/', 'Overhead Basketball Abs', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('13ed08d3-1251-489d-a13e-173bec5213b6'::uuid, 'catalyst-athletics', '772', 'https://www.catalystathletics.com/exercise/772/Prone-Weighted-Arm-Circles/', 'Prone Weighted Arm Circles', 'sets', array['reps', 'rpe']::text[], 'sets', array['reps', 'load', 'rpe']::text[]),
  ('f107814b-42de-455e-90d2-96caeb230942'::uuid, 'catalyst-athletics', '773', 'https://www.catalystathletics.com/exercise/773/Rice-Bucket-Finger-Flexion-Extension/', 'Rice Bucket Finger Flexion & Extension', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('7c20e0a7-9f54-453e-a791-df523e10bb4e'::uuid, 'catalyst-athletics', '774', 'https://www.catalystathletics.com/exercise/774/Rice-Bucket-Wrist-Rotations/', 'Rice Bucket Wrist Rotations', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('d1161851-957b-4c56-95a0-92777912b293'::uuid, 'catalyst-athletics', '560', 'https://www.catalystathletics.com/exercise/560/Step-up/', 'Step-up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('2df44ae4-d386-4202-9a59-5a149909c23a'::uuid, 'catalyst-athletics', '561', 'https://www.catalystathletics.com/exercise/561/Lateral-Step-up/', 'Lateral Step-up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('8fbaf98d-45be-4e73-b6b9-37ce676058a3'::uuid, 'catalyst-athletics', '739', 'https://www.catalystathletics.com/exercise/739/Russian-Step-Up/', 'Russian Step-Up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('0b4aaffd-f6d6-45dc-b96e-acb5e39e315b'::uuid, 'catalyst-athletics', '733', 'https://www.catalystathletics.com/exercise/733/Lateral-Russian-Step-Up/', 'Lateral Russian Step-Up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('82d37dac-168f-47c3-93fb-a8534120e6be'::uuid, 'catalyst-athletics', '738', 'https://www.catalystathletics.com/exercise/738/RNT-Step-Up/', 'RNT Step-Up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('6b85656d-97b4-44ba-b555-7042d892087e'::uuid, 'catalyst-athletics', '598', 'https://www.catalystathletics.com/exercise/598/Reverse-Lunge-Step-up/', 'Reverse Lunge + Step-up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('8a168108-9973-4866-bd26-a3b085b9f6a5'::uuid, 'catalyst-athletics', '579', 'https://www.catalystathletics.com/exercise/579/Step-Down/', 'Step-Down', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('c34446de-ea75-47d7-b604-fba31e673509'::uuid, 'catalyst-athletics', '734', 'https://www.catalystathletics.com/exercise/734/Lateral-Step-Down/', 'Lateral Step-Down', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('85825f76-6625-4265-9e2b-6f298d6405e1'::uuid, 'catalyst-athletics', '546', 'https://www.catalystathletics.com/exercise/546/Bench-Dip/', 'Bench Dip', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('1721457f-c59d-4152-865f-6a36c5a1967f'::uuid, 'catalyst-athletics', '864', 'https://www.catalystathletics.com/exercise/864/Neutral-Grip-Pull-Up/', 'Neutral-Grip Pull-Up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('769ddaad-1c71-4c21-8c78-eb51e992dfbf'::uuid, 'catalyst-athletics', '884', 'https://www.catalystathletics.com/exercise/884/Rope-Pull-up/', 'Rope Pull-up', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('31cc6673-b819-4899-bda8-974aa73e46a8'::uuid, 'catalyst-athletics', '879', 'https://www.catalystathletics.com/exercise/879/Ring-Row/', 'Ring row', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('b9449f92-1ffb-493a-9c1b-1fad3caeb604'::uuid, 'catalyst-athletics', '896', 'https://www.catalystathletics.com/exercise/896/Single-Arm-Ring-Row/', 'Single-Arm Ring Row', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('de863a2d-90cb-4bb9-b7a1-2fe821799eb4'::uuid, 'catalyst-athletics', '755', 'https://www.catalystathletics.com/exercise/755/Nordic-Curl/', 'Nordic Curl', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('3a13fd57-ff75-440d-a827-5ce2d24c5f02'::uuid, 'catalyst-athletics', '113', 'https://www.catalystathletics.com/exercise/113/Glute-Ham-Raise/', 'Glute-Ham Raise', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('c2945031-4a6f-47ff-84ae-e19f5f8d93de'::uuid, 'catalyst-athletics', '749', 'https://www.catalystathletics.com/exercise/749/Wall-Sit/', 'Wall Sit', 'result', array['duration', 'load', 'rpe']::text[], 'result', array['duration', 'rpe']::text[]),
  ('243abb53-7980-4731-b91a-dde79c6d4345'::uuid, 'catalyst-athletics', '744', 'https://www.catalystathletics.com/exercise/744/Single-Leg-Wall-Sit/', 'Single-Leg Wall Sit', 'result', array['duration', 'load', 'rpe']::text[], 'result', array['duration', 'rpe']::text[]),
  ('4b6df634-d97e-47b0-b9af-e291cb95e06d'::uuid, 'catalyst-athletics', '742', 'https://www.catalystathletics.com/exercise/742/Single-Leg-Glute-Bridge-Hold/', 'Single-Leg Glute Bridge Hold', 'result', array['duration', 'load', 'rpe']::text[], 'result', array['duration', 'rpe']::text[]),
  ('29c15226-4c03-482e-a532-e487e52fee5c'::uuid, 'catalyst-athletics', '730', 'https://www.catalystathletics.com/exercise/730/Glute-Bridge/', 'Glute Bridge', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('04338619-974c-4dee-a6e9-4a0d9c7ff39a'::uuid, 'catalyst-athletics', '496', 'https://www.catalystathletics.com/exercise/496/Single-Leg-Glute-Bridge/', 'Single-Leg Glute Bridge', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('f39f5ab3-db0b-4ddd-9149-c0477335c651'::uuid, 'catalyst-athletics', '732', 'https://www.catalystathletics.com/exercise/732/Hamstring-Bridge/', 'Hamstring Bridge', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('f3141fbf-c21e-467b-9bdf-84476e9ca2fd'::uuid, 'catalyst-athletics', '731', 'https://www.catalystathletics.com/exercise/731/Glute-Ham-Bridge-Walkout/', 'Glute-Ham Bridge Walkout', 'sets', array['reps', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('2142cc8b-983a-4fa6-a7c0-df3df5e2dd06'::uuid, 'catalyst-athletics', '527', 'https://www.catalystathletics.com/exercise/527/Plank-March/', 'Plank March', 'result', array['duration', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('a06996ab-558d-449d-acfc-5c8fe10712e5'::uuid, 'catalyst-athletics', '531', 'https://www.catalystathletics.com/exercise/531/Side-Plank-Leg-Lift/', 'Side Plank Leg Lift', 'result', array['duration', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('cb98b5c1-b488-40c7-a9cd-61e3155d5478'::uuid, 'catalyst-athletics', '530', 'https://www.catalystathletics.com/exercise/530/Rolling-Pin/', 'Rolling Pin', 'result', array['duration', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]),
  ('0ba04ee7-cab8-40c6-9fd6-b649492b5a51'::uuid, 'catalyst-athletics', '750', 'https://www.catalystathletics.com/exercise/750/Wall-Sit-March/', 'Wall Sit March', 'result', array['duration', 'load', 'rpe']::text[], 'sets', array['reps', 'rpe']::text[]);

-- Lock matching rows before validation so a concurrent catalog edit cannot
-- slip between the expected-state check and the update.
do $$
declare
  resolved_count integer;
  unexpected_names text;
begin
  perform exercise.id
  from public.exercises exercise
  join reviewed_exercise_defaults reviewed
    on exercise.source_provider = reviewed.source_provider
    and exercise.source_external_id = reviewed.source_external_id
  where exercise.scope = 'global' and exercise.owner_id is null
  for update of exercise;

  select count(*) into resolved_count
  from public.exercises exercise
  join reviewed_exercise_defaults reviewed
    on exercise.source_provider = reviewed.source_provider
    and exercise.source_external_id = reviewed.source_external_id
  where exercise.scope = 'global' and exercise.owner_id is null;
  if resolved_count <> 84 then
    raise exception 'Reviewed exercise defaults expected 84 global identities; found %', resolved_count;
  end if;

  select string_agg(reviewed.name, ', ' order by reviewed.name)
  into unexpected_names
  from public.exercises exercise
  join reviewed_exercise_defaults reviewed
    on exercise.source_provider = reviewed.source_provider
    and exercise.source_external_id = reviewed.source_external_id
  where exercise.scope = 'global' and exercise.owner_id is null
    and (exercise.archived_at is not null
      or exercise.name is distinct from reviewed.name
      or exercise.source_url is distinct from reviewed.source_url
      or not (
        (exercise.default_entry_mode = reviewed.expected_mode
          and exercise.default_tracking_fields = reviewed.expected_fields)
        or (exercise.default_entry_mode = reviewed.recommended_mode
          and exercise.default_tracking_fields = reviewed.recommended_fields)
      ));
  if unexpected_names is not null then
    raise exception 'Reviewed exercise defaults found unexpected identity or fields: %', unexpected_names;
  end if;

  update public.exercises exercise
  set default_entry_mode = reviewed.recommended_mode,
    default_tracking_fields = reviewed.recommended_fields,
    updated_at = now()
  from reviewed_exercise_defaults reviewed
  where exercise.scope = 'global' and exercise.owner_id is null
    and exercise.archived_at is null
    and exercise.source_provider = reviewed.source_provider
    and exercise.source_external_id = reviewed.source_external_id
    and (exercise.default_entry_mode is distinct from reviewed.recommended_mode
      or exercise.default_tracking_fields is distinct from reviewed.recommended_fields);
end;
$$;
