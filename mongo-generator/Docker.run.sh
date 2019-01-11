#!/usr/bin/env sh
# Copyright © 2018 CA. All rights reserved.  CA Confidential.  Please see License.txt file for applicable usage rights and restrictions.
docker run --rm -it --network tdmweb --hostname mongo-generator --name mongo-generator -e ACTION_SECRET=123 \
 -e mongoHost=mongohost \
 -e mongoUser=root \
 -e mongoPassword=example \
 -e mongoAuthDb=admin \
 -p 8443:8443 \
 tdm/mongo-generator:1.0