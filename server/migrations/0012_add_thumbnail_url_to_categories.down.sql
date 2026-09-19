-- Rollback for 0012_add_thumbnail_url_to_categories: drops the thumbnail_url column.
-- Any values stored in it are lost; categories.* is otherwise left untouched.

ALTER TABLE categories
  DROP COLUMN thumbnail_url;
