DROP INDEX reviews_active_association_tuple_idx;

CREATE UNIQUE INDEX reviews_active_basis_set_idx
ON reviews (author_user_id, course_prefix, course_number, instructor_uuid)
NULLS NOT DISTINCT
WHERE publication_state = 'active';
