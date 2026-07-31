-- Friendly organization URLs.
--
-- Adds `organizations.slug` (globally unique) plus the alias table that keeps
-- retired slugs resolving forever.
--
-- The column is added nullable, backfilled, then made NOT NULL in one
-- migration so that `prisma migrate deploy` -- which applies every pending
-- migration in a single pass -- succeeds against a database that already has
-- organizations.
--
-- Backfill caveat: MySQL cannot do NFKD diacritic folding, so an existing
-- organization named "Café Rentals" backfills as `caf-rentals` where the
-- application's slugify() would produce `cafe-rentals`. This is cosmetic --
-- uniqueness is enforced by the index either way -- and applies only to rows
-- present at migration time. Every organization created afterwards is slugged
-- by the application.

ALTER TABLE `organizations`
  ADD COLUMN `slug` VARCHAR(160) NULL AFTER `id`;

-- 1. Base slug: lowercase, collapse each run of non-alphanumerics into a single
--    hyphen, trim leading/trailing hyphens, cap at 160 characters.
UPDATE `organizations`
SET `slug` = TRIM(BOTH '-' FROM
      LEFT(REGEXP_REPLACE(LOWER(`name`), '[^a-z0-9]+', '-'), 160));

-- 2. Names with no usable characters fall back to an id-derived slug.
UPDATE `organizations`
SET `slug` = CONCAT('organization-id-', REPLACE(`id`, '-', ''))
WHERE `slug` IS NULL OR `slug` = '';

-- 3. Reserved segments would shadow a sibling route under /organizations/.
--    Keep in sync with RESERVED_ORGANIZATION_SLUGS in
--    src/app/features/organizations/organization-slug.ts.
UPDATE `organizations`
SET `slug` = CONCAT(`slug`, '-org')
WHERE `slug` IN ('invitations', 'by-slug', 'me', 'new', 'null', 'undefined');

-- 4. A slug shaped like a UUID would shadow a real id lookup.
UPDATE `organizations`
SET `slug` = CONCAT('org-', `slug`)
WHERE `slug` REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 5. A one-character slug is below the minimum the slug route accepts, so an
--    organization named "A" would end up with a public URL that cannot resolve.
UPDATE `organizations`
SET `slug` = CONCAT(`slug`, '-org')
WHERE CHAR_LENGTH(`slug`) < 2;

-- 6. Dedupe, pass 1: readable numeric suffixes; the oldest row keeps the bare
--    slug. LEFT() reserves room so the suffix cannot overflow the column.
UPDATE `organizations` AS o
JOIN (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `slug` ORDER BY `created_at` ASC, `id` ASC
    ) AS rn
  FROM `organizations`
) AS ranked ON ranked.`id` = o.`id`
SET o.`slug` = CONCAT(LEFT(o.`slug`, 150), '-', ranked.rn)
WHERE ranked.rn > 1;

-- 7. Dedupe, pass 2: pass 1 can still collide with a pre-existing literal
--    "foo-2". Anything still duplicated moves into the id-derived reserved
--    namespace, which is unique by construction (id is the primary key) and
--    which slug validation forbids users from choosing.
UPDATE `organizations` AS o
JOIN (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `slug` ORDER BY `created_at` ASC, `id` ASC
    ) AS rn
  FROM `organizations`
) AS ranked ON ranked.`id` = o.`id`
SET o.`slug` = CONCAT('organization-id-', REPLACE(o.`id`, '-', ''))
WHERE ranked.rn > 1;

ALTER TABLE `organizations`
  MODIFY COLUMN `slug` VARCHAR(160) NOT NULL;

CREATE UNIQUE INDEX `organizations_slug_key` ON `organizations`(`slug`);

-- Every slug any organization has ever held, current ones included. Because
-- `slug` is the primary key, claiming one is a single INSERT the database checks
-- against current data -- which is what makes creation and renaming compete for
-- the same key instead of each trusting its own snapshot.
CREATE TABLE `organization_slug_reservations` (
  `slug` VARCHAR(160) NOT NULL,
  `organization_id` VARCHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`slug`),
  INDEX `organization_slug_reservations_organization_id_idx`(`organization_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `organization_slug_reservations`
  ADD CONSTRAINT `organization_slug_reservations_organization_id_fkey`
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Reserve the slugs the backfill just assigned, so they compete for the same key
-- as anything allocated later.
INSERT INTO `organization_slug_reservations` (`slug`, `organization_id`)
SELECT `slug`, `id` FROM `organizations`;
