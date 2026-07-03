// Mock data for script generation testing

export interface Scene {
  sceneId: string;
  title: string;
  content: string;
}

export interface MockApiResponse {
  success: boolean;
  scenes?: Scene[];
  content?: string;
  error?: string;
}

export const mockScriptData = {
  "story_metadata": {
    "M": "Small-town theater community in a rural American setting",
    "T": "Reconciliation with the past; healing through art; the complexities of returning home",
    "G": "Drama",
    "CQ": "Can returning to one's roots provide healing and closure, or does it only reopen old wounds?",
    "SUM": "Fading actor Montgomery Bell returns to his small hometown to care for his ailing mother, a once-celebrated local theater star. While there, he reluctantly agrees to direct and star in a production of 'The Tempest' at the local theater. As he navigates complex relationships—including his mother's bitterness, an old flame's renewed interest, and the town's expectations—Monty rediscovers his passion for theater and begins a journey of healing and self-discovery. The production becomes both a tribute to his mother's legacy and a vehicle for his own emotional catharsis."
  },
  "segments": [
    {
      "id": "S1",
      "title": "Introduction and Stasis",
      "description": "Montgomery Bell returns to his hometown to care for his ailing mother, Evelyn, a once-celebrated local theater star. Their relationship is strained by past conflicts and Evelyn's resentment of Monty's success. As Monty settles back into small-town life, he reconnects with old acquaintances and confronts the weight of their expectations and judgments.",
      "scenes": [
        {
          "sceneId": "S1.1",
          "title": "The Return",
          "content": "Montgomery Bell drives into his hometown, the car windows down, music playing to mask his unease. As he passes familiar landmarks, we see flashes of his past glories through his nostalgia—old friends waving, kids playing, the local diner bustling. He parks outside his childhood home, taking a moment to gather himself before stepping inside."
        },
        {
          "sceneId": "S1.2",
          "title": "A Complicated Reunion",
          "content": "Monty finds his mother, Evelyn, in the living room, watching old recordings of her performances. She pauses the video, and their initial conversation is polite but strained. Evelyn makes a cutting remark about Monty's career, hinting at her jealousy of his success. Monty brushes it off, hiding his hurt behind a forced smile."
        },
        {
          "sceneId": "S1.3",
          "title": "Town Gossip",
          "content": "Monty visits the local diner for a meal, where he is met with a mix of warmth and skepticism from the townspeople. Old friends and acquaintances gather around, sharing stories of Monty's past successes while others whisper about his faded career. Monty feels the weight of their scrutiny as he struggles to engage in lighthearted conversation."
        },
        {
          "sceneId": "S1.4",
          "title": "Unpacking the Past",
          "content": "Back at his mother's house, Monty sorts through old belongings and family mementos. He discovers a box of his mother's awards and scripts, prompting memories of their shared love for theater. As he holds an old photograph of them together on stage, his emotions surface—regret, nostalgia, and a longing for connection. Evelyn interrupts, needing assistance, which highlights their tumultuous relationship further. Monty sighs, realizing the gravity of his situation."
        }
      ]
    },
    {
      "id": "S2",
      "title": "Inciting Incident",
      "description": "Monty encounters Sheila, an old flame, at a welcome-back party. Their reunion stirs up unresolved feelings and creates tension, especially given Sheila's current marriage. As they reconnect and reminisce about their past, the attraction between them becomes evident, setting the stage for emotional complications.",
      "scenes": [
        {
          "sceneId": "S2.1",
          "title": "The Unexpected Spark",
          "content": "Monty attends a welcome-back party thrown by Lila, where he mingles with townsfolk. As he talks about his time in the city, Sheila approaches with a hesitant smile. They share an awkward yet warm exchange, reminiscing about old times. A spark of unspoken feelings lingers as they laugh, prompting Lila to tease Monty about rekindling an old flame."
        },
        {
          "sceneId": "S2.2",
          "title": "A Walk Down Memory Lane",
          "content": "After the party, Monty and Sheila step outside for fresh air. They take a walk around the familiar town, visiting their old hangout spots. Their conversation shifts from lighthearted memories to deeper topics, with Sheila revealing her struggles in her current marriage. Monty, while empathetic, grapples with his own feelings of longing and confusion."
        },
        {
          "sceneId": "S2.3",
          "title": "The Confrontation",
          "content": "Monty receives an urgent call from Sheila, who needs help with a personal crisis. He arrives at her house to find her in tears, having had a fight with her husband. As Monty comforts her, they share a moment of vulnerability that almost escalates into something more. The tension is broken when Sheila's husband returns unexpectedly, leading to a brief, awkward encounter between the three. Monty leaves, unsettled but aware of the emotional pull Sheila has on him."
        }
      ]
    },
    {
      "id": "S3",
      "title": "Commitment",
      "description": "Lila, the local theater director, persuades Monty to direct and star in a production of 'The Tempest.' Despite his initial reluctance, Monty agrees, partly influenced by Sheila's encouragement. This decision deepens the rift with his mother, who resents his involvement in the theater, further complicating their relationship.",
      "scenes": [
        {
          "sceneId": "S3.1",
          "title": "The Proposition",
          "content": "Lila arrives at Monty's house with a script for \"The Tempest.\" She excitedly insists that he read it, expressing her belief that he should direct and star in the local production. Monty resists, citing his lack of interest and commitment. Lila's passion and persistence, along with a hint of manipulation by suggesting the production needs him, eventually wear him down. Monty reluctantly agrees to think about it, but internally struggles with the idea."
        },
        {
          "sceneId": "S3.2",
          "title": "A Difficult Decision",
          "content": "Monty confides in Sheila about Lila's proposal while they share coffee at the diner. He expresses his reluctance and uncertainty about directing the play. Sheila encourages him, pointing out that it could be a positive outlet for him and a way to connect with the community. Their conversation is light, but Monty's internal conflict is apparent as Sheila's support stirs mixed emotions in him."
        },
        {
          "sceneId": "S3.3",
          "title": "The Commitment",
          "content": "Monty visits the local theater, finding Lila and a group of enthusiastic locals preparing for auditions. As he watches them, their excitement begins to infect him. Monty steps up, announcing that he will direct and star in the play. The room erupts in cheers, but Monty's smile is forced, masking his true feelings of apprehension and the weight of his decision."
        },
        {
          "sceneId": "S3.4",
          "title": "The Confrontation with Evelyn",
          "content": "Monty discusses his decision with his mother, hoping for her support. Instead, Evelyn reacts with bitterness, accusing him of abandoning her even more by throwing himself into the play. Their argument escalates, with Evelyn revealing her jealousy and resentment. Monty storms out, hurt and angry, solidifying the emotional stakes of his commitment to the production."
        }
      ]
    },
    {
      "id": "S4",
      "title": "First Pinch Point",
      "description": "Monty struggles with the first rehearsals of 'The Tempest,' facing challenges with the inexperienced cast. Meanwhile, his mother's health deteriorates, forcing him to divide his attention between the play and her care. The stress mounts as he tries to manage both responsibilities, leading to a confrontation with Evelyn that reveals deeper aspects of their complex relationship.",
      "scenes": [
        {
          "sceneId": "S4.1",
          "title": "Tensions Rise",
          "content": "Monty organizes the first rehearsal for \"The Tempest,\" herding an eclectic mix of local talent. The cast struggles with their lines and blocking, resulting in chaos and confusion. Monty's frustration boils over as he tries to maintain order, reflecting his growing stress. Lila, observing from the sidelines, offers quiet encouragement, but Monty brushes her off, snapping at the cast when they forget their cues. The rehearsal ends in disarray, leaving Monty to question his ability to lead."
        },
        {
          "sceneId": "S4.2",
          "title": "A Visit to the Hospital",
          "content": "After a draining rehearsal, Monty visits his mother in the hospital. Evelyn is in a particularly fragile state, exhibiting confusion and anger. During their conversation, she lashes out at Monty, accusing him of neglecting her for the play. Monty, already on edge from the rehearsal, retaliates, reminding her that he is there to care for her. The argument escalates, with Evelyn revealing her fears of being forgotten. Monty storms out, hurt and guilty, torn between his commitments."
        },
        {
          "sceneId": "S4.3",
          "title": "A Heartfelt Confession",
          "content": "Monty seeks solace at the diner, where he confides in Sheila about the rehearsal and his mother's condition. Over coffee, he opens up about the argument, revealing his deep-seated fears of not living up to his mother's legacy or the town's expectations. Sheila listens, her eyes moist with empathy, as Monty's vulnerability lays bare his internal struggles. Their conversation is interrupted by chuckling patrons who overhear a nearby table discussing Monty's performance. He forces a laugh, but Sheila's concerned expression shows she senses his pain."
        },
        {
          "sceneId": "S4.4",
          "title": "A Family Memory",
          "content": "Inspired by his conversation with Sheila, Monty returns home and spends time sorting through more of his mother's belongings. He discovers a collection of her old scripts and letters from her theater days, including one praising her performance in \"The Tempest.\" As he reads, memories of her dedication and passion flood back, softening his heart. Monty sits on the floor, surrounded by memories, and calls a family friend to share stories about Evelyn, reflecting on their relationship and reigniting his passion for the play."
        }
      ]
    },
    {
      "id": "S5",
      "title": "Midpoint",
      "description": "During an emotional rehearsal, Monty breaks down, overwhelmed by the parallels between the play and his own life. Simultaneously, he receives news that his mother's condition has worsened significantly. In a touching moment at her bedside, they share a brief reconciliation, with Evelyn showing a rare moment of support and pride in her son.",
      "scenes": [
        {
          "sceneId": "S5.1",
          "title": "The Tipping Point",
          "content": "During rehearsal, Monty is trying to refine a pivotal scene of \"The Tempest,\" drawing from his own emotional turmoil to guide the actors. Lila, watching from the sidelines, suggests they add a moment of silence after the line \"All the world's a stage.\" Monty agrees, but as they perform, he becomes overwhelmed and breaks down in tears during the scene. The cast, taken aback, halts the rehearsal. Monty steps outside, struggling to regain his composure, while Lila and the actors exchange concerned glances about his well-being."
        },
        {
          "sceneId": "S5.2",
          "title": "The Shock",
          "content": "Monty receives a call from the hospital while at the diner with Sheila, informing him that his mother's condition has deteriorated. He rushes to the hospital, with Sheila trying to comfort him. In the hospital room, Monty finds Evelyn unconscious, her face peaceful but fragile. As he holds her hand, he grapples with his mixed feelings—anger, love, and regret—reflecting on their turbulent relationship. A nurse quietly informs him that they are moving her to hospice care. Monty steps out, visibly shaken, and leans against the wall, taking deep breaths as he processes the news."
        },
        {
          "sceneId": "S5.3",
          "title": "The Confrontation",
          "content": "Evelyn is moved to a private room in hospice, and Monty sits by her bedside, keeping a vigil. She awakens briefly, not fully coherent, but manages to communicate her pride in him through slurred words. Monty, fighting tears, confesses how lost he feels and how he's using the play to cope. Evelyn, in a moment of clarity, grabs his hand and tells him to stop being so hard on himself. The exchange is emotional, providing a bittersweet sense of reconciliation. Monty leaves the room after her words, feeling both comforted and conflicted about what comes next."
        }
      ]
    },
    {
      "id": "S6",
      "title": "Second Pinch Point",
      "description": "Evelyn passes away, leaving Monty to grapple with grief and unresolved feelings. Despite his loss, he decides to continue with the play as a tribute to his mother. The rehearsals take on new meaning as he channels his emotions into his performance, earning the respect and support of the cast.",
      "scenes": [
        {
          "sceneId": "S6.1",
          "title": "The Heartbreaking Loss",
          "content": "Monty receives the call about his mother's passing while at home, surrounded by scattered scripts and notes for the play. The news leaves him numb, and he sits in silence, staring at a photo of them together from his childhood. The weight of his loss begins to sink in as he processes the reality of her absence."
        },
        {
          "sceneId": "S6.2",
          "title": "A Visit to the Funeral Home",
          "content": "Monty visits the funeral home to make arrangements. The director, a local friend, offers gentle guidance. Monty struggles to articulate what his mother would have wanted, reflecting on their complex relationship. As he flips through casket options, memories of Evelyn's vibrant personality flood back, leading to a mix of laughter and tears as he recalls her theatrical flair."
        },
        {
          "sceneId": "S6.3",
          "title": "The Decision to Perform",
          "content": "Monty confides in Lila and the cast at a rehearsal about his mother's death. He expresses his uncertainty about continuing with the play, his voice trembling with emotion. The cast rallies around him, sharing their own stories of loss and resilience. Inspired by their support and a sense of duty, Monty announces that they will go on with the performance as a tribute to his mother."
        },
        {
          "sceneId": "S6.4",
          "title": "Rehearsal with Purpose",
          "content": "During a tense rehearsal, Monty channels his grief into the performance. He delivers his lines with raw emotion, the cast moved by his sincerity. Lila suggests they incorporate a moment of silence in Evelyn's honor. Monty agrees, grateful for the community's solidarity as they work together to honor both the play and his mother's memory."
        }
      ]
    },
    {
      "id": "S7",
      "title": "Second Plot Point",
      "description": "The opening night of 'The Tempest' is a triumph, with Monty's performance resonating deeply with the audience. His portrayal of Prospero, infused with his personal grief and journey, captures the town's attention. However, the emotional high is short-lived when a confrontation with Sheila's husband disrupts the post-performance celebration, bringing simmering tensions to the surface.",
      "scenes": [
        {
          "sceneId": "S7.1",
          "title": "The Performance",
          "content": "The theater is packed as Monty prepares for the opening night of \"The Tempest.\" Backstage, he paces nervously, the weight of his mother's memory and his personal struggles heavy on him. Lila and the cast offer words of encouragement, but Monty is lost in his thoughts. As the stage manager calls for places, Monty takes a deep breath, whispering a quiet goodbye to his mother before stepping onto the stage."
        },
        {
          "sceneId": "S7.2",
          "title": "A Tribute to Evelyn",
          "content": "During the performance, Monty's portrayal of Prospero is infused with his raw grief and emotional turmoil. He improvises moments that reflect his personal journey, weaving in subtle tributes to his mother. The audience is captivated, many moved to tears by the authenticity of his performance. In the final act, he delivers a heartfelt monologue that echoes his own struggles with loss and forgiveness, leaving the audience in stunned silence before they erupt into applause."
        },
        {
          "sceneId": "S7.3",
          "title": "The Aftermath",
          "content": "Backstage, the cast and crew celebrate the successful performance, praising Monty for his incredible portrayal. He accepts their compliments, but his emotions are still raw. Monty steps outside for a breath of fresh air, where he is approached by Sheila. They share a quiet moment, with Sheila acknowledging the impact of his performance. Monty confesses that he feels both liberated and vulnerable, using the moment to reflect on his journey and the path ahead."
        },
        {
          "sceneId": "S7.4",
          "title": "The Confrontation",
          "content": "After the performance, Monty attends a gathering at the diner where townspeople discuss the play. Sheila's husband, feeling threatened by Monty's success, critiques the performance harshly. Monty overhears and confronts him, leading to a heated argument. Sheila tries to intervene, but Monty's anger boils over, resulting in a physical altercation that spills out onto the diner's patio, drawing the attention of the entire town."
        }
      ]
    },
    {
      "id": "S8",
      "title": "Climax",
      "description": "A negative review of the play by Sheila's husband creates a divide in the town. The tension culminates in a physical confrontation between Monty and Sheila's husband, stemming from the latter's disparaging comments about Monty's performance and intentions. The brawl becomes a public spectacle, forcing Monty to confront both his inner demons and the town's perception of him.",
      "scenes": [
        {
          "sceneId": "S8.1",
          "title": "The Review",
          "content": "Theater lobby bustling with excitement after the performance. Monty, still in his costume, is surrounded by cast members who are congratulating him. Lila beams at him, stating, \"That was your best performance ever!\" As the celebration continues, a local newspaper journalist approaches Monty, asking for a quick interview. Monty agrees, feeling buoyed by the praise around him. During the interview, he reflects on the performance as a tribute to his mother and his journey of self-discovery, speaking candidly about his experiences."
        },
        {
          "sceneId": "S8.2",
          "title": "The Negative Review",
          "content": "At the diner the next day, townsfolk gather to discuss the play over coffee. A copy of the newspaper is propped up on the counter, displaying Sheila's husband's scathing review of the performance. As patrons read aloud quotes like \"a self-indulgent display masquerading as art,\" the mood shifts. Some agree with the critique, while others defend Monty, pointing out how deeply his performance resonated. The conversation grows heated, with fans of Monty arguing against Sheila's husband's harsh words."
        },
        {
          "sceneId": "S8.3",
          "title": "The Confrontation",
          "content": "Monty, unaware of the review, attends a gathering at the diner. As he mingles, someone brings up the negative review. Monty brushes it off at first, but the comments from Sheila's husband escalate into a heated exchange. Sheila's husband, feeling bold, taunts Monty about the review, implying that his emotional performance was merely a cry for attention. Monty tries to remain composed, but the jabs cut deep. Monty retorts sharply, defending his integrity and the performance. The tension mounts until Monty storms out, anger boiling over."
        },
        {
          "sceneId": "S8.4",
          "title": "The Brawl",
          "content": "Outside the diner, Monty paces to cool off. Sheila follows, concerned. Before they can talk, Sheila's husband steps outside, his bravado intact. He makes another snide comment about Monty's \"desperate need for validation.\" Unable to hold back, Monty lunges at him, and they begin to fight. The scuffle attracts the attention of the entire town, who gather to watch. Sheila stands by, torn between wanting to stop the fight and feeling conflicted about her loyalties. The fight ends with Monty standing over Sheila's husband, breathing heavy, as the crowd murmurs in shock. Monty storms away, leaving the townspeople buzzing."
        }
      ]
    },
    {
      "id": "S9",
      "title": "Resolution",
      "description": "In the aftermath of the confrontation, Monty makes peace with his time in the town. He bids farewell to the theater cast and crew, acknowledging their support during his journey. Before leaving, he has a final, bittersweet encounter with Sheila, where they acknowledge their feelings but accept the reality of their separate paths. Monty departs with a newfound sense of closure and purpose.",
      "scenes": [
        {
          "sceneId": "S9.1",
          "title": "The Aftermath",
          "content": "The diner is still buzzing from the brawl, with townspeople discussing Monty's fight with Sheila's husband. Some praise Monty for standing up for himself, while others express concern about his behavior. A small group of admirers recounts how his performance touched them, emphasizing its impact despite the negative review. Lila, overhearing the chatter, smiles to herself, proud of Monty's effect on the town."
        },
        {
          "sceneId": "S9.2",
          "title": "A Final Goodbye",
          "content": "Monty visits the theater one last time, where the cast is cleaning up after the production. He thanks everyone for their hard work and support, expressing his gratitude for the experience. Lila pulls him aside for a private conversation, urging him to stay and continue building on his success. Monty smiles gently, acknowledging her words but explaining that he needs to move on. They share an emotional farewell, with Lila expressing her hope for his future."
        },
        {
          "sceneId": "S9.3",
          "title": "A Farewell to Sheila",
          "content": "Monty stops by Sheila's house, knowing it's his last chance to see her before leaving town. He finds her in the living room, looking surprised but pleased to see him. They share small talk before Monty's demeanor shifts, and he confesses that he's leaving. Sheila's eyes well with unshed tears as she processes his decision. They share a heartfelt conversation about their past, Monty acknowledging the significance of their connection but also recognizing the need to move forward. The moment culminates in a passionate kiss, lingering but bittersweet. Monty pulls away, his expression a mix of clarity and uncertainty. He says goodbye and walks out, leaving Sheila standing in the doorway, contemplative."
        },
        {
          "sceneId": "S9.4",
          "title": "Driving Away",
          "content": "Monty packs his car, the trunk filled with memories and remnants of his time in town. As he drives away, he passes familiar landmarks, each one evoking a sense of closure. The music playing in the car is softer, more reflective than when he first arrived. Monty's expression is calm, a quiet confidence evident as he navigates the road ahead. The camera lingers on his face as he drives into the distance, leaving his future open-ended but with a sense of purpose and acceptance."
        }
      ]
    }
  ]
};

// Mock API for generating screenplay scripts from scenes
export const generateScriptFromScene = (sceneId: string): MockApiResponse => {
  // Find the scene from the mock data
  let foundScene: any = null;
  let foundBeat: any = null;

  mockScriptData.segments.forEach(beat => {
    beat.scenes.forEach(scene => {
      if (scene.sceneId === sceneId) {
        foundScene = scene;
        foundBeat = beat;
      }
    });
  });

  if (!foundScene || !foundBeat) {
    return {
      success: false,
      error: 'Scene not found'
    };
  }

  // Generate a script based on the scene
  // In a real implementation, this would be an API call to your backend

  // For slugline, extract location from scene content if possible
  let location = 'BEDROOM';
  if (foundScene.content.toLowerCase().includes('diner')) {
    location = 'DINER';
  } else if (foundScene.content.toLowerCase().includes('theater')) {
    location = 'THEATER';
  } else if (foundScene.content.toLowerCase().includes('hospital')) {
    location = 'HOSPITAL';
  } else if (foundScene.content.toLowerCase().includes('living room')) {
    location = 'LIVING ROOM';
  }

  // For time of day, default to DAY but check content
  let timeOfDay = 'DAY';
  if (foundScene.content.toLowerCase().includes('night')) {
    timeOfDay = 'NIGHT';
  } else if (foundScene.content.toLowerCase().includes('evening')) {
    timeOfDay = 'EVENING';
  } else if (foundScene.content.toLowerCase().includes('morning')) {
    timeOfDay = 'MORNING';
  }

  // Extract character names
  const characters = ['MONTY', 'EVELYN', 'LILA', 'SHEILA'];
  if (foundScene.content.toLowerCase().includes('sheila\'s husband')) {
    characters.push('ROBERT'); // Assume Sheila's husband is named Robert
  }

  // Create a basic script structure
  const script = `<p data-line-type="scene">INT. ${location} - ${timeOfDay}</p>
  <p data-line-type="description">${foundScene.content.split('.')[0]}.</p>
  <p data-line-type="description">${foundScene.title} - ${foundBeat.title}</p>
  <p data-line-type="character">${characters[0]}</p>
  <p data-line-type="dialogue">This script would be generated based on the scene "${foundScene.title}" from ${foundBeat.title}.</p>
  <p data-line-type="description">The character actions and motivations would be derived from the scene description.</p>
  <p data-line-type="character">${characters.length > 1 ? characters[1] : characters[0]}</p>
  <p data-line-type="parenthetical">(emotional)</p>
  <p data-line-type="dialogue">The dialogue would reflect the themes of ${mockScriptData.story_metadata.T} and explore the central question: ${mockScriptData.story_metadata.CQ}</p>
  <p data-line-type="description">The scene would build on the existing narrative and character development established in previous scenes.</p>`;

  return {
    success: true,
    content: script
  };
};

// Mock API for fetching scenes for a beat
export const fetchScenesForBeat = (beatId: string): MockApiResponse => {
  // Find the beat from the mock data
  const beat = mockScriptData.segments.find(segment => segment.id === beatId);

  if (!beat) {
    return {
      success: false,
      error: 'Beat not found'
    };
  }

  return {
    success: true,
    scenes: beat.scenes
  };
};