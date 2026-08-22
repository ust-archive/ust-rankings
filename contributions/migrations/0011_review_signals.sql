CREATE TABLE review_thumbs_votes (
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  review_id uuid NOT NULL REFERENCES reviews(id),
  state text NOT NULL CHECK (state IN ('up', 'down')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, review_id)
);

CREATE INDEX review_thumbs_counts_idx
ON review_thumbs_votes (review_id, state);

CREATE TABLE review_emoji_reactions (
  user_id uuid NOT NULL REFERENCES contribution_users(id),
  review_id uuid NOT NULL REFERENCES reviews(id),
  code text NOT NULL CHECK (
    code IN ('love', 'laugh', 'surprised', 'confused', 'sad', 'angry', 'fire')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, review_id, code)
);

CREATE INDEX review_emoji_counts_idx
ON review_emoji_reactions (review_id, code);
