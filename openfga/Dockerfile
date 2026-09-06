# Wrapper around the official OpenFGA image so the datastore migration runs at
# container start (migrate; then run). Needed because Render's free tier does
# not allow a preDeployCommand, and the upstream OpenFGA image is distroless
# (no shell) so "migrate && run" can't be chained via dockerCommand.
#
# The OpenFGA binary is a static (CGO-free) Go binary, so it runs fine on
# Alpine. `openfga migrate` is idempotent, so running it on every boot is safe.
# CA certs are copied from the upstream image (no network install needed) so
# TLS to a managed Postgres works.
FROM ghcr.io/openfga/openfga:latest AS ofga

FROM alpine:3.20
COPY --from=ofga /openfga /usr/local/bin/openfga
COPY --from=ofga /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
EXPOSE 8080
CMD ["/bin/sh", "-c", "openfga migrate && openfga run"]
