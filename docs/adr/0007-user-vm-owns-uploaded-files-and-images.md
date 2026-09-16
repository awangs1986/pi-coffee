# Uploaded files and images belong to the User VM

Status: accepted

0.1 streams uploads through the Control Plane only as transport and persists the original bytes in the owning User VM's Task inbox. The Control Plane keeps no durable body or thumbnail. Image delivery chooses a model-supported image block or a User VM path/reference, preserving the original for later inspection.
