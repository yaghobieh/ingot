export const GIT_SERVICE_PATH = '/services/ingot/git';
export const GIT_URI_SCHEME = 'ingot-git';
export const GIT_LOG_LIMIT = 200;
export const FIELD_SEP = '\x1f';
export const RECORD_SEP = '\x1e';
export const LOG_FORMAT = ['%H', '%h', '%an', '%aI', '%s', '%D'].join('%x1f') + '%x1e';
export const BRANCH_FORMAT = ['%(HEAD)', '%(refname)', '%(upstream:short)', '%(upstream:track)'].join('%09');
export const EMPTY_TREE_REF = '';
