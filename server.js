const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const serviceAccount = require('./key/tale-test-bd56c-firebase-adminsdk-g9g4f-12e29c421a.json'); // 경로 확인 필요

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  //databaseURL: "https://your-firebase-project.firebaseio.com" // Firebase 프로젝트의 URL
});

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());
const port = 3000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

//팀분배 로직
function distributeTeamsLogic(teams, teamsPerGroup) {
  let groups = [];
  let remainingTeams = [...teams];
  while (remainingTeams.length > 0) {
    const currentGroup = [];
    remainingTeams = remainingTeams.filter(team => {
      if (currentGroup.length < teamsPerGroup && !currentGroup.some(t => t.teamName === team.teamName)) {
        currentGroup.push(team);
        return false;
      }
      return true;
    });
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
  }
  return groups;
}

//팀 분배 엔드포인트
app.post('/distributeTeams', async (req, res) => {
  const { competitionId, teamsPerGroup } = req.body;
  try {
    const snapshot = await db.collection('Competition').doc(competitionId).collection('Receipt').get();
    let teams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let groups = distributeTeamsLogic(teams, teamsPerGroup);

    // Firestore에 결과 저장
    const batch = db.batch();
    groups.forEach((group, index) => {
      group.forEach(team => {
        const teamRef = db.collection('Competition').doc(competitionId).collection('Receipt').doc(team.id);
        batch.update(teamRef, { group: `Group ${index + 1}` });
      });
    });
    await batch.commit();

    res.status(200).json({ success: true, message: 'Teams distributed successfully' });
  } catch (error) {
    console.error('Error distributing teams:', error);
    res.status(500).json({ success: false, message: 'Failed to distribute teams', error: error.toString() });
  }
});

// 토너먼트 매치 생성 로직
function generateTournamentMatches(participants) {
  let rounds = Math.ceil(Math.log2(participants.length));
  let matches = [];
  for (let round = 1; round <= rounds; round++) {
    let roundMatches = [];
    for (let i = 0; i < Math.pow(2, rounds - round); i++) {
      roundMatches.push({ team1: null, team2: null, round: round });
    }
    matches.push(...roundMatches);
  }
  return matches;
}

// 참가자를 매치에 할당
function assignParticipantsToMatches(matches, participants) {
  participants.forEach((participant, index) => {
    if (index % 2 === 0) {
      matches[Math.floor(index / 2)].team1 = participant.id;
    } else {
      matches[Math.floor(index / 2)].team2 = participant.id;
    }
  });
  return matches;
}

// 토너먼트 매치 생성 엔드포인트
app.post('/createTournament', async (req, res) => {
  const { competitionId } = req.body;
  try {
    const participantsSnapshot = await db.collection('Competition').doc(competitionId).collection('Receipt').get();
    let participants = participantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let matches = generateTournamentMatches(participants);
    matches = assignParticipantsToMatches(matches, participants);

    const batch = db.batch();
    matches.forEach(match => {
      const matchRef = db.collection('Competition').doc(competitionId).collection('Tournament').doc();
      batch.set(matchRef, match);
    });

    await batch.commit();
    res.status(200).json({ success: true, message: 'Tournament matches created successfully' });
  } catch (error) {
    console.error('Error creating tournament matches:', error);
    res.status(500).json({ success: false, message: 'Failed to create tournament matches', error: error.toString() });
  }
});


// 대회 상태 업데이트
app.patch('/updateCompetitionState', async (req, res) => {
  const { competitionId, newState } = req.body;
  try {
    await db.collection('Competition').doc(competitionId).update({ currentState: newState });
    res.status(200).json({ success: true, message: 'Competition state updated successfully' });
  } catch (error) {
    console.error('Error updating competition state:', error);
    res.status(500).json({ success: false, message: 'Failed to update competition state', error: error.toString() });
  }
});

// 참가자 스트림
app.get('/streamParticipants', async (req, res) => {
  const { competitionId } = req.query;
  const participantsRef = db.collection('Competition').doc(competitionId).collection('Receipt');
  participantsRef.onSnapshot(snapshot => {
    let participants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log('Updated Participants:', participants);
  });
});

// 참가자 추가 엔드포인트
app.post('/addParticipant', async (req, res) => {
  const { competitionId, participant } = req.body;
  try {
    const participantRef = db.collection('Competition').doc(competitionId).collection('Receipt').doc();
    await participantRef.set(participant);
    res.status(200).json({ success: true, message: 'Participant added successfully', participantId: participantRef.id });
  } catch (error) {
    console.error('Error adding participant:', error);
    res.status(500).json({ success: false, message: 'Failed to add participant', error: error.toString() });
  }
});

// 결과 업데이트 엔드포인트
app.post('/updateResult', async (req, res) => {
  const { competitionId, matchId, result } = req.body;
  try {
    const matchRef = db.collection('Competition').doc(competitionId).collection('resultLeague').doc(matchId);
    await matchRef.update(result);
    res.status(200).json({ success: true, message: 'Match result updated successfully' });
  } catch (error) {
    console.error('Error updating match result:', error);
    res.status(500).json({ success: false, message: 'Failed to update match result', error: error.toString() });
  }
});

// 결과 스트림
app.get('/streamResults', (req, res) => {
  const { competitionId } = req.query;
  const matchesRef = db.collection('Competition').doc(competitionId).collection('resultLeague');
  matchesRef.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added' || change.type === 'modified') {
        console.log('Match Updated:', change.doc.data());
      }
    });
  });

  res.status(200).json({ success: true, message: 'Listening for results...' });
});


//읽기
app.get('/getCompetition', async (req, res) => {
  try{
    const competition =  db.collection('Competition').get();
    let competitionList = (await competition).docs.map( doc => doc.data);
    res.status(200).json(competitionList);
  }catch(error){
    console.error('대회 읽기 중 오류', error);
    res.status(500).json({success: false, message: '읽기오류', error: error.error.toString()});
  }
});
