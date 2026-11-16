-- Runs once when the Postgres volume is first created.
-- cl_owner owns the schema and runs migrations; cl_app is the least-privileged role used by web + worker.
create role cl_app login password 'cl_app_dev';
create extension if not exists vector;
create extension if not exists pg_trgm;
create database competence_lab_test owner cl_owner;
\connect competence_lab_test
create extension if not exists vector;
create extension if not exists pg_trgm;
