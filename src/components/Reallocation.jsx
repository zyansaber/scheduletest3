import React, { useState, useEffect } from 'react';
import { ref, set, get, push } from 'firebase/database';
import { collection, addDoc } from "firebase/firestore";
import { database, firestoreDB } from '../utils/firebase';

const Reallocation = ({ data }) => {
  const [reallocationRows, setReallocationRows] = useState([{ 
    id: 1, 
    chassisNumber: '', 
    currentVanInfo: null, 
    selectedDealer: '', 
    message: '' 
  }]);
  const [allDealers, setAllDealers] = useState([]);
  const [reallocationRequests, setReallocationRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');
  const [stats, setStats] = useState({ totalPending: 0, totalDone: 0, dealerStats: {} });
  const [showFilter, setShowFilter] = useState('all'); // 'all', 'pending', 'done'

  // Get unique dealers
  useEffect(() => {
    if (data && data.length > 0) {
      const dealers = [...new Set(data.map(item => item.Dealer).filter(Boolean))].sort();
      setAllDealers(dealers);
    }
  }, [data]);

  // Load requests on mount
  useEffect(() => {
    loadReallocationRequests();
  }, []);

  // Recalculate stats when requests change
  useEffect(() => {
    calculateStats();
  }, [reallocationRequests]);

  const loadReallocationRequests = async () => {
    try {
      const reallocationRef = ref(database, 'reallocation-bk');
      const snapshot = await get(reallocationRef);

      if (snapshot.exists()) {
        const requestsData = snapshot.val();

        // Flatten { chassis: { id: record } }
        const requestsList = Object.entries(requestsData).flatMap(([chassis, records]) =>
          Object.entries(records).map(([id, data]) => ({
            id,
            chassisNumber: chassis,
            ...data
          }))
        ).sort((a, b) => new Date(b.submitTime) - new Date(a.submitTime));

        setReallocationRequests(requestsList);
      } else {
        setReallocationRequests([]);
      }
    } catch (error) {
      console.error('Error loading reallocation requests:', error);
    }
  };

  const calculateStats = () => {
    const dealerStats = {};
    let totalPending = 0;
    let totalDone = 0;

    reallocationRequests.forEach(request => {
      if (request.status === 'completed') {
        totalDone++;
      } else {
        totalPending++;
      }

      if (request.originalDealer) {
        dealerStats[request.originalDealer] = dealerStats[request.originalDealer] || { moved_from: 0, moved_to: 0 };
        dealerStats[request.originalDealer].moved_from++;
      }

      if (request.reallocatedTo) {
        dealerStats[request.reallocatedTo] = dealerStats[request.reallocatedTo] || { moved_from: 0, moved_to: 0 };
        dealerStats[request.reallocatedTo].moved_to++;
      }
    });

    setStats({ totalPending, totalDone, dealerStats });
  };

  const handleChassisNumberChange = (rowId, chassis) => {
    const newRows = reallocationRows.map(row => {
      if (row.id === rowId) {
        if (chassis) {
          const vanInfo = data.find(item => 
            item.Chassis && item.Chassis.toLowerCase() === chassis.toLowerCase()
          );

          if (vanInfo) {
            const signedPlansReceived = vanInfo['Signed Plans Received'] || '';
            let message = '';
            if (signedPlansReceived.toLowerCase() === 'no') {
              message = "⚠️ The van isn't signed, please sign off or cancel to reorder";
            }

            return { ...row, chassisNumber: chassis, currentVanInfo: vanInfo, selectedDealer: '', message };
          } else {
            return { ...row, chassisNumber: chassis, currentVanInfo: null, selectedDealer: '', message: 'Chassis number not found' };
          }
        } else {
          return { ...row, chassisNumber: chassis, currentVanInfo: null, selectedDealer: '', message: '' };
        }
      }
      return row;
    });
    setReallocationRows(newRows);
  };

  const handleDealerChange = (rowId, dealer) => {
    setReallocationRows(reallocationRows.map(row => row.id === rowId ? { ...row, selectedDealer: dealer } : row));
  };

  const addRow = () => {
    const newId = Math.max(...reallocationRows.map(r => r.id)) + 1;
    setReallocationRows([...reallocationRows, { id: newId, chassisNumber: '', currentVanInfo: null, selectedDealer: '', message: '' }]);
  };

  const removeRow = (rowId) => {
    if (reallocationRows.length > 1) {
      setReallocationRows(reallocationRows.filter(row => row.id !== rowId));
    }
  };

  const getMelbourneTime = () => {
    return new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const handleSubmit = async () => {
    const validRows = reallocationRows.filter(row => canSubmitRow(row));

    if (validRows.length === 0) {
      setGlobalMessage('Please enter valid chassis numbers and select dealers for at least one row');
      return;
    }

    setLoading(true);
    try {
      const promises = validRows.map(async (row) => {
        const chassis = row.chassisNumber || 'Unknown';
        const dealer = row.selectedDealer || 'Unknown';
        const currentVan = row.currentVanInfo || {};

        const reallocationData = {
          status: currentVan['Regent Production'] || 'Unknown',
          originalDealer: currentVan.Dealer || 'Unknown',
          reallocatedTo: dealer,
          submitTime: getMelbourneTime(),
          model: currentVan.Model || '',
          customer: currentVan.Customer || '',
          signedPlansReceived: currentVan['Signed Plans Received'] || ''
        };

        // Use push so multiple records per chassis are allowed
        const reallocationRef = ref(database, `reallocation-bk/${chassis}`);
        await push(reallocationRef, reallocationData);

        // Firestore email queue
        await addDoc(collection(firestoreDB, "reallocation_mail"), {
          to: ["dongning@regentrv.com.au"],
          message: {
            subject: `New Reallocation Request: Chassis ${chassis}`,
            text: `Chassis number ${chassis} has been requested to dealer ${dealer}.`,
            html: `Chassis number <strong>${chassis}</strong> has been requested to dealer <strong>${dealer}</strong>.`,
          },
        });
      });

      await Promise.all(promises);

      setGlobalMessage(`Successfully submitted ${validRows.length} reallocation request(s)!`);
      setReallocationRows([{ id: 1, chassisNumber: '', currentVanInfo: null, selectedDealer: '', message: '' }]);
      await loadReallocationRequests();
    } catch (error) {
      console.error('❌ Error submitting reallocation requests:', error);
      setGlobalMessage('Error submitting requests. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDone = async (chassisNumber, id) => {
    try {
      const reallocationRef = ref(database, `reallocation-bk/${chassisNumber}/${id}/status`);
      await set(reallocationRef, 'completed');
      await loadReallocationRequests();
      setGlobalMessage('Reallocation marked as completed');
    } catch (error) {
      console.error('❌ Error marking reallocation as done:', error);
      setGlobalMessage('Error updating status. Please try again.');
    }
  };

  const handleIssueUpdate = async (chassisNumber, id, issueType) => {
    try {
      const issueRef = ref(database, `reallocation-bk/${chassisNumber}/${id}/issue`);
      await set(issueRef, { type: issueType, timestamp: getMelbourneTime() });

      await addDoc(collection(firestoreDB, "reallocation_mail"), {
        to: ["dongning@regentrv.com.au"],
        message: {
          subject: `New Issue: Chassis ${chassisNumber}`,
          html: `Chassis number <strong>${chassisNumber}</strong> has been marked as <strong>${issueType}</strong>.`,
        },
      });

      await loadReallocationRequests();
      setGlobalMessage(`Issue "${issueType}" recorded for ${chassisNumber}`);
    } catch (error) {
      console.error('Error updating issue:', error);
      setGlobalMessage('Error recording issue. Please try again.');
    }
  };

  const canSubmitRow = (row) => {
    if (!row.currentVanInfo || !row.selectedDealer) return false;
    const status = row.currentVanInfo['Regent Production'] || '';
    const signedPlansReceived = row.currentVanInfo['Signed Plans Received'] || '';
    if (status.toLowerCase() === 'finished') return false;
    if (signedPlansReceived.toLowerCase() === 'no') return false;
    return true;
  };

  const canSubmitAnyRow = () => reallocationRows.some(row => canSubmitRow(row));

  const filteredRequests = reallocationRequests.filter(request => {
    if (showFilter === 'pending') return request.status !== 'completed';
    if (showFilter === 'done') return request.status === 'completed';
    return true;
  });

  // ... keep the rest of your rendering logic unchanged
  // just remember in the table to call:
  //   handleMarkDone(request.chassisNumber, request.id)
  //   handleIssueUpdate(request.chassisNumber, request.id, issueType)

  return (
    <div>
      {/* Your existing JSX layout remains here */}
    </div>
  );
};

export default Reallocation;
