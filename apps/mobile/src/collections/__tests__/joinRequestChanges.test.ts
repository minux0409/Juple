import { cancelMyJoinRequest } from '../api/collectionsApi';
import { subscribeJoinRequestWithdrawn } from '../joinRequestChanges';
it('notifies list caches only after a successful request cancellation', async () => {
 const listener = jest.fn(); const unsubscribe = subscribeJoinRequestWithdrawn(listener);
 const fail = jest.fn().mockRejectedValue(new Error('offline'));
 await expect(cancelMyJoinRequest(fail, 9)).rejects.toThrow('offline');
 expect(listener).not.toHaveBeenCalled();
 const success = jest.fn().mockResolvedValue({status:204});
 await cancelMyJoinRequest(success,9);
 expect(success).toHaveBeenCalledWith({method:'DELETE',path:'/api/v1/collections/join-requests/mine/9'});
 expect(listener).toHaveBeenCalledWith(9);
 unsubscribe();
});
