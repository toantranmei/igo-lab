-- Run once on the Coolify Postgres of igo-lab (image pgvector/pgvector:pg17), connected as its superuser
-- to the database `competence_lab`. The superuser URL is DATABASE_OWNER_URL of the web app (it runs the migrations
-- and grants); web and worker connect as the least-privileged role cl_app (DATABASE_URL).
-- Replace the password before running: openssl rand -hex 32 (hex, so it is safe inside a URL).
create role cl_app login password 'REPLACE_WITH_APP_PASSWORD';
create extension if not exists vector;
create extension if not exists pg_trgm;
