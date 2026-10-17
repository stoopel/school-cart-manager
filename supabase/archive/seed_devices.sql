-- הוספת מחשבים לעגלה א (14a68b75-5a0d-4b00-af16-7e6fee481658)
INSERT INTO devices (cart_id, device_number, asset_tag) VALUES
  ('14a68b75-5a0d-4b00-af16-7e6fee481658', 1,  'A-001'),
  ('14a68b75-5a0d-4b00-af16-7e6fee481658', 2,  'A-002'),
  ('14a68b75-5a0d-4b00-af16-7e6fee481658', 3,  'A-003'),
  ('14a68b75-5a0d-4b00-af16-7e6fee481658', 4,  'A-004'),
  ('14a68b75-5a0d-4b00-af16-7e6fee481658', 5,  'A-005')
ON CONFLICT DO NOTHING;

-- הוספת מחשבים לעגלה ב (ff80f18d-e0fa-4938-823e-a49bf9f8e780)
INSERT INTO devices (cart_id, device_number, asset_tag) VALUES
  ('ff80f18d-e0fa-4938-823e-a49bf9f8e780', 1,  'B-001'),
  ('ff80f18d-e0fa-4938-823e-a49bf9f8e780', 2,  'B-002'),
  ('ff80f18d-e0fa-4938-823e-a49bf9f8e780', 3,  'B-003'),
  ('ff80f18d-e0fa-4938-823e-a49bf9f8e780', 4,  'B-004'),
  ('ff80f18d-e0fa-4938-823e-a49bf9f8e780', 5,  'B-005')
ON CONFLICT DO NOTHING;

-- הוספת מחשבים לעגלה ג (d01cfd1d-aba7-4195-816c-eb7fe193aa6c)
INSERT INTO devices (cart_id, device_number, asset_tag) VALUES
  ('d01cfd1d-aba7-4195-816c-eb7fe193aa6c', 1,  'C-001'),
  ('d01cfd1d-aba7-4195-816c-eb7fe193aa6c', 2,  'C-002'),
  ('d01cfd1d-aba7-4195-816c-eb7fe193aa6c', 3,  'C-003'),
  ('d01cfd1d-aba7-4195-816c-eb7fe193aa6c', 4,  'C-004'),
  ('d01cfd1d-aba7-4195-816c-eb7fe193aa6c', 5,  'C-005')
ON CONFLICT DO NOTHING;
