-- Rich-text blog bodies can exceed the 65,535-byte TEXT limit that the API
-- validator allows (up to 100,000 characters), so widen the column to
-- MEDIUMTEXT (up to ~16 MB) to keep request validation and persistence aligned.
ALTER TABLE `organization_blog_posts`
  MODIFY `body` MEDIUMTEXT NOT NULL;
