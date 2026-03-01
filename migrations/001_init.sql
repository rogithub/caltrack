CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuidv7(),
  email             TEXT UNIQUE NOT NULL,
  api_key           TEXT UNIQUE NOT NULL,
  weight_kg         NUMERIC(5,2),
  height_cm         NUMERIC(5,2),
  date_of_birth     DATE,
  biological_sex    TEXT CHECK (biological_sex IN ('male', 'female')),
  activity_level    TEXT CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE meals (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  user_id     UUID NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  calories    INTEGER NOT NULL,
  protein_g   NUMERIC(5,1),
  carbs_g     NUMERIC(5,1),
  fat_g       NUMERIC(5,1),
  eaten_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
