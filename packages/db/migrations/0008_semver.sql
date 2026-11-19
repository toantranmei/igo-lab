-- P3.1: dictionary versions become MAJOR.MINOR.PATCH; the old two-part label n.m reads as n.m.0
UPDATE "release" SET "version_label" = "version_label" || '.0' WHERE "version_label" ~ '^[0-9]+\.[0-9]+$';
