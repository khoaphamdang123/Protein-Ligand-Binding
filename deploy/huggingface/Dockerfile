# Hugging Face Docker Space: the whole app from the image pushed to Docker Hub (built from the Dockerfile at the root
# of this repository). Replace <dockerhub-user>; the Docker Hub repository must be public for the Space to pull it.
FROM docker.io/<dockerhub-user>/bindsite:latest

# Self-hosted ESMFold takes ~14 GB of RAM and is very slow on a few vCPUs: off on Hugging Face. Structures then come from
# the 4036 precomputed ones, the ESM Atlas API, or a PDB upload. Delete this line on hardware with >= 32 GB of RAM to
# keep it as the last automatic source.
ENV BINDSITE_ESMFOLD_LOCAL=off
