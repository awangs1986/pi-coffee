# Browser lifetime is independent of Pi Session lifetime

Status: accepted

A Browser Shell connection is a projection of a Host Session, not the owner of that Session. Closing or refreshing the browser detaches the projection while the Host continues Pi work and buffers Events for a cursor-based reconnect. This is why Web Server and Host are separate seams from the first MVP.
