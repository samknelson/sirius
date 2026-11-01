# Local filesystem path restrictions

`FILESYSTEMS` remains the sole filesystem configuration input. Local providers
refuse `/` and the trees `/proc`, `/sys`, `/dev`, `/etc`, and `/run`, including
descendants and physical aliases such as `/var/run`. These are fixed code
restrictions: there is no allowlist, additional setting, or configurable bypass.
Component boundaries matter: a name such as `/srv/etc-backup` is not `/etc`.

Both normalized written paths and physically resolved paths are checked. Future
directories are resolved through their nearest existing ancestor before creation.
Dangling symlinks and paths that cannot be resolved safely are refused. The
existing traversal and symlink-containment checks still apply to local operations.
Allowed, initially nonexistent storage directories can still be created by writes.

## Compatibility and configuration

Previously accepted local configurations using prohibited paths now fail startup
or filesystem-registry reload with an error naming the filesystem and path.
Reload validates the entire candidate first; failure retains the previous active
filesystem configuration and cached providers. Operations independently enforce
the path restriction, including if a base is redirected after initialization.
S3 and Replit storage behavior is unchanged.

No deployment values are changed automatically, and no existing files are moved
or deleted. Operators must choose an appropriate non-sensitive local storage
directory themselves before restarting or reloading an incompatible configuration.

To lock `FILESYSTEMS` against in-app overrides, continue to supply a real,
nonempty deployment environment value other than `__UNSET__`. That value wins
over the stored in-app override under the existing precedence rules. An absent,
empty, or `__UNSET__` deployment value leaves the variable available to the
existing override mechanism. This change does not restrict generic variable
writes or alter that precedence.

## Limits

Blocking sensitive system trees is defense in depth, not a guarantee against
reading secrets stored in other administrator-selected directories. In particular,
an allowed application or home directory can still contain credentials or private
files. Choose dedicated storage directories and appropriate OS permissions.
This is not protection against an attacker who controls the operating system,
mounts, or storage directories, and it is not a general secret-location classifier.
